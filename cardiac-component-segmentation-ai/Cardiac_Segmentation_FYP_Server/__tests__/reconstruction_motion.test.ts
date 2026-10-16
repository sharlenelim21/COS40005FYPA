// Smooth heart motion service: where the file lives, what the status says, and that a build is started only once and
// a failure is remembered (so a page polling it does not hammer the GPU service). S3, the GPU client and axios are mocked.
jest.mock("../src/services/s3_handler", () => ({
    downloadFromS3: jest.fn(),
    extractS3KeyFromUrl: jest.fn((url: string) => url.replace(/^https?:\/\/[^/]+\/[^/]+\//, "")),
    getS3FileSize: jest.fn(),
    uploadToS3: jest.fn(),
}));
jest.mock("../src/utils/s3_presigned_url", () => ({
    generatePresignedGetUrl: jest.fn(async (_bucket: string, key: string) => `https://signed.example/${key}`),
}));
jest.mock("../src/services/gpu_auth_client", () => ({
    getFreshGPUServerAddress: jest.fn(async () => "http://gpu:8001"),
    getCurrentToken: jest.fn(() => "token"),
}));
jest.mock("../src/services/logger", () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock("axios");

import axios from "axios";
import { downloadFromS3, getS3FileSize, uploadToS3 } from "../src/services/s3_handler";
import { clearFailedMotion, getMotion, motionUrlFor, startMotion } from "../src/services/reconstruction_motion";

const TAR = "http://minio:9000/bucket/user/recon/case_4D_lv.tar";
const source = (reconstructionId: string) => ({ reconstructionId, tarUrl: TAR, chamber: "lv", userId: "user" });
// The build runs in the background (real temp files): wait until it has left "processing".
async function finished(id: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
        if ((await getMotion(source(id))).status !== "processing") return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("the motion build did not finish");
}

beforeAll(() => {
    process.env.AWS_BUCKET_NAME = "bucket";
});

beforeEach(() => {
    jest.clearAllMocks();
    (axios.isAxiosError as unknown as jest.Mock) = jest.fn(() => false);
});

describe("motionUrlFor", () => {
    it("puts the motion file beside the tar", () => {
        expect(motionUrlFor(TAR)).toBe("http://minio:9000/bucket/user/recon/case_4D_lv.motion.ffd2.bin");
        expect(motionUrlFor("http://minio:9000/bucket/a/mesh")).toBe("http://minio:9000/bucket/a/mesh.motion.ffd2.bin");
    });
});

describe("getMotion", () => {
    it("is missing when the file is not in S3", async () => {
        (getS3FileSize as jest.Mock).mockResolvedValue(0);
        await expect(getMotion(source("r-missing"))).resolves.toEqual({ status: "missing" });
    });

    it("is ready with a signed link when the file exists, and asks S3 only once", async () => {
        (getS3FileSize as jest.Mock).mockResolvedValue(1024);
        const first = await getMotion(source("r-ready"));
        const second = await getMotion(source("r-ready"));
        expect(first).toEqual({ status: "ready", url: "https://signed.example/user/recon/case_4D_lv.motion.ffd2.bin" });
        expect(second).toEqual(first);
        expect(getS3FileSize).toHaveBeenCalledTimes(1);
    });
});

describe("startMotion", () => {
    it("builds once: sends the tar to the GPU service and stores the result beside it", async () => {
        (getS3FileSize as jest.Mock).mockResolvedValue(0);
        (downloadFromS3 as jest.Mock).mockImplementation(async (_b: string, _k: string, path: string) => {
            await require("fs").promises.writeFile(path, Buffer.from("tar bytes"));
        });
        (axios.post as jest.Mock).mockResolvedValue({ data: new Uint8Array([86, 72, 77, 79]).buffer, headers: {} });
        (uploadToS3 as jest.Mock).mockResolvedValue(undefined);

        const first = await startMotion(source("r-build"));
        const again = await startMotion(source("r-build"));            // while processing: no second build
        expect(first.status).toBe("processing");
        expect(again.status).toBe("processing");
        await finished("r-build");

        expect(axios.post).toHaveBeenCalledTimes(1);
        const [url, body, options] = (axios.post as jest.Mock).mock.calls[0];
        expect(url).toBe("http://gpu:8001/inference/v2/4d-motion");
        expect(Buffer.from(body).toString()).toBe("tar bytes");
        expect(options.params).toEqual({ chamber: "lv" });
        expect(options.headers.Authorization).toBe("Bearer token");
        expect((uploadToS3 as jest.Mock).mock.calls[0][5]).toBe("user/recon/case_4D_lv.motion.ffd2.bin");
        await expect(getMotion(source("r-build"))).resolves.toEqual({ status: "ready", url: "https://signed.example/user/recon/case_4D_lv.motion.ffd2.bin" });
    });

    it("remembers a failure until it is cleared", async () => {
        (getS3FileSize as jest.Mock).mockResolvedValue(0);
        (downloadFromS3 as jest.Mock).mockRejectedValue(new Error("S3 down"));

        await startMotion(source("r-fail"));
        await finished("r-fail");
        await expect(getMotion(source("r-fail"))).resolves.toEqual({ status: "failed", error: "S3 down" });
        await expect(startMotion(source("r-fail"))).resolves.toMatchObject({ status: "failed" });
        expect(downloadFromS3).toHaveBeenCalledTimes(1);

        clearFailedMotion("r-fail");
        await expect(getMotion(source("r-fail"))).resolves.toEqual({ status: "missing" });
    });
});
