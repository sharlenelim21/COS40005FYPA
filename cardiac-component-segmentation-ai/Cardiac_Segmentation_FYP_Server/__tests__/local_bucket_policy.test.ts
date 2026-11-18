// ensureLocalBucket creates the local MinIO bucket. A developer copy keeps anonymous read (what minio-setup did);
// an installed copy sets S3_ANONYMOUS_READ=none (docker-compose.yml, from VH_MINIO_ANON in release.env) so patient
// files can only be fetched through presigned URLs.

const sent: string[] = [];

jest.mock("../src/services/database", () => ({ projectModel: {} }));
jest.mock("../src/services/logger", () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

jest.mock("@aws-sdk/client-s3", () => {
  const actual = jest.requireActual("@aws-sdk/client-s3");
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({
      send: jest.fn(async (command: { constructor: { name: string } }) => {
        sent.push(command.constructor.name);
        if (command.constructor.name === "HeadBucketCommand") {
          throw { $metadata: { httpStatusCode: 404 } };
        }
        return {};
      }),
    })),
  };
});

function loadHandler(anonymousRead: string | undefined) {
  process.env.STORAGE_MODE = "s3";
  process.env.AWS_REGION = "us-east-1";
  process.env.AWS_BUCKET_NAME = "visheart-bucket";
  process.env.S3_ENDPOINT = "http://minio:9000";
  if (anonymousRead === undefined) delete process.env.S3_ANONYMOUS_READ;
  else process.env.S3_ANONYMOUS_READ = anonymousRead;
  let handler: typeof import("../src/services/s3_handler") | undefined;
  jest.isolateModules(() => {
    handler = require("../src/services/s3_handler");
  });
  return handler!;
}

describe("ensureLocalBucket", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it("gives a developer copy's new bucket anonymous read, as minio-setup did", async () => {
    await loadHandler(undefined).ensureLocalBucket();
    expect(sent).toContain("CreateBucketCommand");
    expect(sent).toContain("PutBucketPolicyCommand");
  });

  it("leaves an installed copy's new bucket private when S3_ANONYMOUS_READ is none", async () => {
    await loadHandler("none").ensureLocalBucket();
    expect(sent).toContain("CreateBucketCommand");
    expect(sent).not.toContain("PutBucketPolicyCommand");
  });
});
