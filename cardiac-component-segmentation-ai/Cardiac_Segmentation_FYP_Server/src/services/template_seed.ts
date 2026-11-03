// File: src/services/template_seed.ts
// Description: Loads the template hearts committed to the repo
// (visheart-local-deployment/seed/templates, written by
// `scripts/templates/template_tool.py export`) into this machine's MongoDB and
// object storage on start-up, so a teammate sees the same read-only templates
// after merging and restarting the stack, without running anything.
//
// A template is (re)loaded only when it is missing, or when it was loaded from
// an older seed (templateInfo.seedVersion differs). Templates published on this
// machine have no seedVersion and are never touched, so a restart can't replace
// newer local edits with an older export.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import logger from "./logger";

const serviceLocation = "TemplateSeed";
const { EJSON, ObjectId } = mongoose.mongo.BSON;

// The collections that hold a template's documents besides `projects` (same as the exporter's).
const SEED_COLLECTIONS = ["segmentation masks", "project landmarks", "jobs", "4d reconstructions"];

interface SeedObject { key: string; file: string; size: number; sha256: string }
interface SeedTemplate {
    project_id: string;
    name: string;
    version: string;
    db: { file: string; sha256: string };
    objects: SeedObject[];
}
interface SeedManifest { format: number; template_account: string; templates: SeedTemplate[] }

/** The seed folder: TEMPLATE_SEED_DIR, the Docker mount, or the repo folder when run outside Docker. */
function findSeedDir(): string | null {
    const candidates = [
        process.env.TEMPLATE_SEED_DIR,
        "/app/seed/templates",
        path.resolve(__dirname, "../../../visheart-local-deployment/seed/templates"),
    ];
    return candidates.find((d) => d && fs.existsSync(path.join(d, "manifest.json"))) ?? null;
}

/** Decompress an .xz file. Node has no xz support; the Python the analysis scripts use does. */
function unxz(file: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const child = spawn("python3", ["-c",
            "import lzma, shutil, sys; shutil.copyfileobj(lzma.open(sys.argv[1]), sys.stdout.buffer)", file]);
        const chunks: Buffer[] = [];
        let stderr = "";
        child.stdout.on("data", (c: Buffer) => chunks.push(c));
        child.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
        child.on("error", reject);
        child.on("close", (code) => code === 0
            ? resolve(Buffer.concat(chunks))
            : reject(new Error(`could not decompress ${path.basename(file)}: ${stderr.trim().slice(0, 300)}`)));
    });
}

const sha256 = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");

/** Same S3 settings as s3_handler.ts (MinIO locally). */
function makeS3Client(): S3Client | null {
    const region = process.env.AWS_REGION || process.env.S3_REGION;
    if (process.env.STORAGE_MODE !== "s3" || !region || !process.env.AWS_BUCKET_NAME) return null;
    return new S3Client({
        region,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
        ...(process.env.S3_ENDPOINT
            ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true" }
            : {}),
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
    });
}

/** Upload the file unless the bucket already holds an object of that size at its key. */
async function putObject(s3: S3Client, dir: string, o: SeedObject): Promise<boolean> {
    const Bucket = process.env.AWS_BUCKET_NAME!;
    try {
        const head = await s3.send(new HeadObjectCommand({ Bucket, Key: o.key }));
        if (head.ContentLength === o.size) return false;
    } catch {
        // not there yet
    }
    const body = await unxz(path.join(dir, o.file));
    if (sha256(body) !== o.sha256) throw new Error(`${o.file} is damaged (checksum mismatch)`);
    await s3.send(new PutObjectCommand({
        Bucket, Key: o.key, Body: body,
        ContentType: o.key.endsWith(".tar") ? "application/x-tar" : "application/octet-stream",
    }));
    return true;
}

/** The account that owns every template. Its password is random and never stored anywhere. */
async function ensureTemplateAccount(dir: string, manifest: SeedManifest): Promise<boolean> {
    const db = mongoose.connection.db!;
    const account = EJSON.parse(fs.readFileSync(path.join(dir, manifest.template_account), "utf-8"), { relaxed: false });
    const users = db.collection("users");
    if (await users.findOne({ _id: account._id })) return true;
    const sameName = await users.findOne({ username: account.username });
    if (sameName) {
        logger.error(`${serviceLocation}: a different user is already called "${account.username}" — templates not loaded.`);
        return false;
    }
    const password = await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10);
    await users.insertOne({ ...account, password });
    logger.info(`${serviceLocation}: created the template account "${account.username}".`);
    return true;
}

async function loadTemplate(dir: string, s3: S3Client, t: SeedTemplate): Promise<void> {
    const db = mongoose.connection.db!;
    const raw = await unxz(path.join(dir, t.db.file));
    if (sha256(raw) !== t.db.sha256) throw new Error(`${t.db.file} is damaged (checksum mismatch)`);
    const docs: { c: string; d: any }[] = raw.toString("utf-8").split("\n").filter(Boolean)
        .map((line) => EJSON.parse(line, { relaxed: false }));
    const project = docs.find((x) => x.c === "projects")?.d;
    if (!project) throw new Error(`${t.db.file} has no project document`);

    // Replace any earlier copy. The project goes in first, marked as loading, so the
    // job cleanup sees it and an interrupted load is retried on the next start.
    const pid = new ObjectId(t.project_id);
    for (const c of SEED_COLLECTIONS) {
        await db.collection(c).deleteMany({ projectid: { $in: [t.project_id, pid] } });
    }
    await db.collection("projects").deleteOne({ _id: pid });
    await db.collection("projects").insertOne({
        ...project, templateInfo: { ...(project.templateInfo ?? {}), seedVersion: "loading" },
    });

    let uploaded = 0;
    for (const o of t.objects) {
        if (await putObject(s3, dir, o)) uploaded++;
    }
    for (const c of SEED_COLLECTIONS) {
        const rows = docs.filter((x) => x.c === c).map((x) => x.d);
        if (rows.length) await db.collection(c).insertMany(rows);
    }
    await db.collection("projects").updateOne({ _id: pid }, { $set: { "templateInfo.seedVersion": t.version } });
    logger.info(`${serviceLocation}: loaded "${t.name}" (${docs.length} documents, ${uploaded}/${t.objects.length} files uploaded).`);
}

/**
 * Load the committed template hearts that this machine doesn't have yet (or has
 * from an older seed). Never throws: a failure is logged and retried on the next start.
 * Set TEMPLATE_SEED=off to skip.
 */
export async function loadTemplateSeed(): Promise<void> {
    try {
        if (process.env.TEMPLATE_SEED === "off") return;
        const dir = findSeedDir();
        if (!dir) {
            logger.info(`${serviceLocation}: no template seed folder found — skipped.`);
            return;
        }
        const manifest: SeedManifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf-8"));
        if (manifest.format !== 1) {
            logger.warn(`${serviceLocation}: unknown seed format ${manifest.format} — skipped.`);
            return;
        }

        const projects = mongoose.connection.db!.collection("projects");
        const todo: SeedTemplate[] = [];
        for (const t of manifest.templates) {
            const existing = await projects.findOne(
                { _id: new ObjectId(t.project_id) }, { projection: { name: 1, "templateInfo.seedVersion": 1 } });
            const loadedVersion = existing?.templateInfo?.seedVersion;
            if (!existing || (loadedVersion && loadedVersion !== t.version)) todo.push(t);
        }
        if (!todo.length) {
            logger.info(`${serviceLocation}: ${manifest.templates.length} template(s) already up to date.`);
            return;
        }

        const s3 = makeS3Client();
        if (!s3) {
            logger.warn(`${serviceLocation}: object storage is not configured (STORAGE_MODE=s3) — templates not loaded.`);
            return;
        }
        if (!(await ensureTemplateAccount(dir, manifest))) return;
        logger.info(`${serviceLocation}: loading ${todo.length} template(s) from ${dir} ...`);
        for (const t of todo) {
            try {
                await loadTemplate(dir, s3, t);
            } catch (err) {
                logger.error(`${serviceLocation}: could not load "${t.name}": ${(err as Error).message}`);
            }
        }
    } catch (err) {
        logger.error(`${serviceLocation}: template seed failed: ${(err as Error).message}`);
    }
}
