// ensureLocalBucket creates the local MinIO bucket private in every copy (F1, 3c2880f): no bucket policy is ever
// applied, so nobody can list or download the bucket anonymously; the app serves every object through presigned URLs.
// The old S3_ANONYMOUS_READ setting (developer copies "download", installed copies "none") is gone; these tests check
// that no value of it, left in someone's environment, brings anonymous read back.

const sent: string[] = [];
let bucketExists = false;

jest.mock("../src/services/database", () => ({ projectModel: {} }));
jest.mock("../src/services/logger", () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

jest.mock("@aws-sdk/client-s3", () => {
  const actual = jest.requireActual("@aws-sdk/client-s3");
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({
      send: jest.fn(async (command: { constructor: { name: string } }) => {
        sent.push(command.constructor.name);
        if (command.constructor.name === "HeadBucketCommand" && !bucketExists) {
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

// The bucket commands only: loading s3_handler also sends its start-up write test (a PutObjectCommand).
const bucketCommands = () => sent.filter(name => name.includes("Bucket"));

describe("ensureLocalBucket", () => {
  beforeEach(() => {
    sent.length = 0;
    bucketExists = false;
  });

  it.each([
    ["a developer copy (no setting)", undefined],
    ["an environment still saying download", "download"],
    ["an installed copy's old none", "none"],
  ])("creates the bucket private for %s", async (_who, anonymousRead) => {
    await loadHandler(anonymousRead).ensureLocalBucket();
    expect(bucketCommands()).toEqual(["HeadBucketCommand", "CreateBucketCommand"]);   // no PutBucketPolicyCommand
  });

  it("leaves an existing bucket as it is", async () => {
    bucketExists = true;
    await loadHandler(undefined).ensureLocalBucket();
    expect(bucketCommands()).toEqual(["HeadBucketCommand"]);
  });
});
