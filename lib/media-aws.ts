import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { CreateJobCommand, GetJobCommand, MediaConvertClient, type JobStatus } from "@aws-sdk/client-mediaconvert";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";

// The AWS side of uploading lesson videos from the admin page (actions/videos.ts). Credentials come from the
// SDK's default chain: on Amplify, the app's compute role (infra/media/template.yaml, PlatformComputeRole); on
// your PC, the profile in AWS_PROFILE (.env.local). No access keys are stored in the app.
//
// Encoding runs as a role of its own, the encoder role (EncoderRole), when MEDIA_ENCODER_ROLE_ARN is set (on
// Amplify): starting a MediaConvert job hands MediaConvert its role (iam:PassRole), and Amplify assumes the compute
// role with a session policy that denies every iam: action. The compute role assumes the encoder role, whose session
// carries no such policy. On your PC, leave it unset: your profile starts the jobs itself.
//
// The region is our own variable: Amplify reserves names that start with AWS_ for itself.

const region = process.env.MEDIA_AWS_REGION ?? "us-east-1";
const encoderRoleArn = process.env.MEDIA_ENCODER_ROLE_ARN;

export function mediaUploadsConfigured(): boolean {
  return Boolean(process.env.MEDIA_BUCKET && process.env.MEDIA_CONVERT_ROLE_ARN);
}

function config() {
  const bucket = process.env.MEDIA_BUCKET;
  const roleArn = process.env.MEDIA_CONVERT_ROLE_ARN;
  if (!bucket || !roleArn) throw new Error("MEDIA_BUCKET and MEDIA_CONVERT_ROLE_ARN must be set to upload videos");
  return { bucket, roleArn };
}

const globalForAws = globalThis as unknown as { mediaS3?: S3Client; mediaConvert?: MediaConvertClient };
const s3 = () => (globalForAws.mediaS3 ??= new S3Client({ region }));
const mediaConvert = () =>
  (globalForAws.mediaConvert ??= new MediaConvertClient({
    region,
    // Short sessions, renewed by the SDK before they expire.
    ...(encoderRoleArn
      ? { credentials: fromTemporaryCredentials({ params: { RoleArn: encoderRoleArn, RoleSessionName: "academia-encode", DurationSeconds: 900 }, clientConfig: { region } }) }
      : {}),
  }));

export type PresignedUpload = { url: string; headers: Record<string, string> };

/**
 * A URL the browser can PUT one file to, for an hour, with the headers it must send: both are part of the
 * signature, so the file lands with the type and cache rules chosen here and nothing else.
 */
export async function presignUpload(key: string, contentType: string, cacheControl?: string): Promise<PresignedUpload> {
  const command = new PutObjectCommand({ Bucket: config().bucket, Key: key, ContentType: contentType, CacheControl: cacheControl });
  const url = await getSignedUrl(s3(), command, { expiresIn: 3600, signableHeaders: new Set(["content-type", "cache-control"]) });
  return { url, headers: { "Content-Type": contentType, ...(cacheControl ? { "Cache-Control": cacheControl } : {}) } };
}

/** Writes a small file the server made (a caption track) under courses/, cached for good: a new version gets a new key. */
export async function putMediaFile(key: string, body: string, contentType: string): Promise<void> {
  if (!key.startsWith("courses/")) throw new Error("Only files under courses/ are written here");
  await s3().send(new PutObjectCommand({ Bucket: config().bucket, Key: key, Body: body, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }));
}

export async function deleteUpload(key: string): Promise<void> {
  if (!key.startsWith("uploads/")) throw new Error("Only originals under uploads/ are deleted here");
  await s3().send(new DeleteObjectCommand({ Bucket: config().bucket, Key: key }));
}

/** The encoded size: the long side at most 1920 px and the short side at most 1080, even numbers, never larger. */
export function outputSize(width?: number | null, height?: number | null): { width: number; height: number } | null {
  if (!width || !height) return null;
  const scale = Math.min(1, 1920 / Math.max(width, height), 1080 / Math.min(width, height));
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/**
 * Starts the encode: H.264 (QVBR, 5 Mb/s at most) and AAC in an MP4 with its index at the front, written as
 * `<outputPrefix>video.mp4`. The size is what the browser reported, scaled down to 1080p; a phone video's rotation
 * is applied first.
 */
export async function startEncodeJob(input: {
  sourceKey: string;
  outputPrefix: string;
  width?: number | null;
  height?: number | null;
  metadata: Record<string, string>;
}): Promise<string> {
  const { bucket, roleArn } = config();
  const size = outputSize(input.width, input.height);
  const result = await mediaConvert().send(
    new CreateJobCommand({
      Role: roleArn,
      UserMetadata: input.metadata,
      StatusUpdateInterval: "SECONDS_10",
      Settings: {
        TimecodeConfig: { Source: "ZEROBASED" },
        Inputs: [
          {
            FileInput: `s3://${bucket}/${input.sourceKey}`,
            TimecodeSource: "ZEROBASED",
            VideoSelector: { Rotate: "AUTO" },
            AudioSelectors: { "Audio Selector 1": { DefaultSelection: "DEFAULT" } },
          },
        ],
        OutputGroups: [
          {
            Name: "File Group",
            OutputGroupSettings: {
              Type: "FILE_GROUP_SETTINGS",
              // The last part of the destination is the file's name: video.mp4.
              FileGroupSettings: { Destination: `s3://${bucket}/${input.outputPrefix}video` },
            },
            Outputs: [
              {
                ContainerSettings: { Container: "MP4", Mp4Settings: { MoovPlacement: "PROGRESSIVE_DOWNLOAD" } },
                VideoDescription: {
                  ...(size ?? {}),
                  ScalingBehavior: "DEFAULT",
                  CodecSettings: {
                    Codec: "H_264",
                    H264Settings: {
                      RateControlMode: "QVBR",
                      QvbrSettings: { QvbrQualityLevel: 8 },
                      MaxBitrate: 5_000_000,
                      CodecProfile: "HIGH",
                      CodecLevel: "AUTO",
                      GopSize: 2,
                      GopSizeUnits: "SECONDS",
                      SceneChangeDetect: "TRANSITION_DETECTION",
                      QualityTuningLevel: "SINGLE_PASS_HQ",
                      FramerateControl: "INITIALIZE_FROM_SOURCE",
                    },
                  },
                },
                AudioDescriptions: [
                  {
                    AudioSourceName: "Audio Selector 1",
                    CodecSettings: { Codec: "AAC", AacSettings: { Bitrate: 128_000, CodingMode: "CODING_MODE_2_0", SampleRate: 48_000 } },
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  );
  const id = result.Job?.Id;
  if (!id) throw new Error("MediaConvert did not return a job id");
  return id;
}

export type EncodeJob = { status: JobStatus | "UNKNOWN"; percent: number | null; error: string | null };

export async function getEncodeJob(jobId: string): Promise<EncodeJob> {
  const { Job } = await mediaConvert().send(new GetJobCommand({ Id: jobId }));
  return {
    status: Job?.Status ?? "UNKNOWN",
    percent: Job?.JobPercentComplete ?? null,
    error: Job?.ErrorMessage ? `${Job.ErrorMessage}${Job.ErrorCode ? ` (${Job.ErrorCode})` : ""}` : null,
  };
}
