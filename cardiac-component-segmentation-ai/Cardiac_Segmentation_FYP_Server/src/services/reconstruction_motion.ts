// File: src/services/reconstruction_motion.ts
// Description: Smooth heart motion for the landmark page's 3D heart. A finished 4D reconstruction is one mesh per frame,
// each meshed on its own, so frames share no vertices and the page swaps whole meshes during playback. This service
// sends the reconstruction's tar to the GPU service's /inference/v2/4d-motion (motion_mesh.py), which returns the
// end-diastole mesh's own vertices moved onto every frame, and stores that file beside the tar in S3
// ("<tar>.motion.ffd1.bin"). The page keeps loading the ED mesh and its ED AHA labels and only moves the vertices.
// No database field is added: the file's presence in S3 is the state, and a running build is remembered in memory.
import fs from "fs";
import os from "os";
import path from "path";
import axios from "axios";
import logger from "./logger";
import { downloadFromS3, extractS3KeyFromUrl, getS3FileSize, uploadToS3 } from "./s3_handler";
import { generatePresignedGetUrl } from "../utils/s3_presigned_url";
import { getCurrentToken, getFreshGPUServerAddress } from "./gpu_auth_client";

const serviceLocation = "Service (Reconstruction motion)";
const GPU_TIMEOUT_MS = 15 * 60 * 1000;   // CPU work: about 20 s per chamber on a desktop, minutes on a slow laptop

export type MotionStatus =
    | { status: "missing" }
    | { status: "processing"; startedAt: string }
    | { status: "failed"; error: string }
    | { status: "ready"; url: string };

type State = { status: "processing"; startedAt: string } | { status: "failed"; error: string } | { status: "ready"; key: string };
const states = new Map<string, State>();

export interface MotionSource {
    reconstructionId: string;
    tarUrl: string;              // the reconstruction's reconstructedMesh.path (an S3 URL ending in .tar)
    chamber?: string;            // "lv" | "rv"
    userId: string;
}

// The motion file is named after the GPU method that made it (motion_mesh.py's METHOD, also in the file's header): when
// the method changes, change both, and every reconstruction's motion is rebuilt on its next view (files made by an
// older method are simply no longer looked at).
const MOTION_SUFFIX = ".motion.ffd1.bin";

/** The motion file's S3 URL: beside the tar, same name, MOTION_SUFFIX. */
export function motionUrlFor(tarUrl: string): string {
    return /\.tar$/i.test(tarUrl) ? tarUrl.replace(/\.tar$/i, MOTION_SUFFIX) : `${tarUrl}${MOTION_SUFFIX}`;
}

async function presign(key: string): Promise<string | null> {
    const bucket = process.env.AWS_BUCKET_NAME;
    return bucket ? generatePresignedGetUrl(bucket, key, 3600) : null;
}

/** Where the motion of this reconstruction stands; checks S3 once, then remembers. */
export async function getMotion(source: MotionSource): Promise<MotionStatus> {
    const state = states.get(source.reconstructionId);
    if (state?.status === "processing") return state;
    if (state?.status === "failed") return state;
    const motionUrl = motionUrlFor(source.tarUrl);
    const key = state?.status === "ready" ? state.key : extractS3KeyFromUrl(motionUrl);
    if (!key) return { status: "missing" };
    if (state?.status !== "ready") {
        const size = await getS3FileSize(motionUrl);
        if (!size) return { status: "missing" };
        states.set(source.reconstructionId, { status: "ready", key });
    }
    const url = await presign(key);
    return url ? { status: "ready", url } : { status: "failed", error: "The motion file could not be shared." };
}

function describe(error: unknown): string {
    if (axios.isAxiosError(error)) {
        const data = error.response?.data;
        let detail = "";
        if (data) {
            try {
                const text = Buffer.isBuffer(data) || data instanceof ArrayBuffer ? Buffer.from(data as ArrayBuffer).toString("utf8") : String(data);
                detail = JSON.parse(text)?.detail ?? text;
            } catch {
                detail = "";
            }
        }
        if (error.response) return `The GPU service refused the motion request (${error.response.status}${detail ? `: ${detail}` : ""}).`;
        return `The GPU service could not be reached (${error.code ?? error.message}).`;
    }
    return error instanceof Error ? error.message : String(error);
}

async function build(source: MotionSource): Promise<void> {
    const bucket = process.env.AWS_BUCKET_NAME;
    const tarKey = extractS3KeyFromUrl(source.tarUrl);
    const motionUrl = motionUrlFor(source.tarUrl);
    const motionKey = extractS3KeyFromUrl(motionUrl);
    if (!bucket || !tarKey || !motionKey) throw new Error("The reconstruction's file location is not readable.");

    const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), "visheart-motion-"));
    try {
        const tarPath = path.join(work, "reconstruction.tar");
        await downloadFromS3(bucket, tarKey, tarPath);
        const archive = await fs.promises.readFile(tarPath);

        const base = await getFreshGPUServerAddress();
        const token = getCurrentToken();
        if (!base || !token) throw new Error("The GPU service is not configured or not signed in.");
        const started = Date.now();
        const response = await axios.post(`${base}/inference/v2/4d-motion`, archive, {
            params: source.chamber ? { chamber: source.chamber } : {},
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-tar" },
            responseType: "arraybuffer",
            timeout: GPU_TIMEOUT_MS,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
        });
        const motionPath = path.join(work, "motion.bin");
        await fs.promises.writeFile(motionPath, Buffer.from(response.data as ArrayBuffer));
        const upload = fs.createReadStream(motionPath);
        try {
            await uploadToS3(upload, source.userId, source.reconstructionId, ".bin", "", motionKey);
        } finally {
            upload.destroy();               // Windows cannot remove the folder while the file is still open
        }
        states.set(source.reconstructionId, { status: "ready", key: motionKey });
        logger.info(`${serviceLocation}: motion for reconstruction ${source.reconstructionId} ready in ${Date.now() - started} ms ` +
                    `(${response.headers["x-motion-stats"] ?? "no stats"})`);
    } finally {
        // A leftover temp folder is not a failed build: log it and keep the result.
        await fs.promises.rm(work, { recursive: true, force: true, maxRetries: 3 }).catch(error =>
            logger.warn(`${serviceLocation}: could not remove ${work}: ${(error as Error).message}`));
    }
}

/** Start building this reconstruction's motion unless it exists, is being built, or failed (clearFailedMotion first to
 * try again); returns the state right after. */
export async function startMotion(source: MotionSource): Promise<MotionStatus> {
    const current = await getMotion(source);
    if (current.status !== "missing") return current;
    const state = { status: "processing" as const, startedAt: new Date().toISOString() };
    states.set(source.reconstructionId, state);
    build(source).catch(error => {
        const message = describe(error);
        logger.error(`${serviceLocation}: motion for reconstruction ${source.reconstructionId} failed: ${message}`);
        states.set(source.reconstructionId, { status: "failed", error: message });
    });
    return state;
}

/** Forget a failed attempt so it can be tried again. */
export function clearFailedMotion(reconstructionId: string): void {
    if (states.get(reconstructionId)?.status === "failed") states.delete(reconstructionId);
}
