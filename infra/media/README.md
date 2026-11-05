# Media: lesson videos on S3 and CloudFront

Lesson videos, their captions and posters live in a **private S3 bucket** that only a **CloudFront distribution**
at `https://media.academiadelcodigo.com` can read. The platform hands the browser **signed URLs** that expire after
6 to 12 hours (`lib/media.ts`), so a video can't be hot-linked or embedded elsewhere, and the bucket stays closed.

| File | Purpose |
|---|---|
| `template.yaml` | CloudFormation: the bucket, the distribution with its certificate and DNS records, the signing key group and the CORS policy for captions |

## Why this shape

- **Not in git, not in Amplify.** Videos are large binaries; the repo and the app bundle are the wrong place.
- **S3 + CloudFront, in the account that already hosts the platform and the domain** (`dalejo`, us-east-1). One
  stack, one bill, DNS and the certificate created and validated automatically.
- **Plain MP4 (progressive download).** lk-react's `<InteractiveVideo>` plays a file the browser can play
  (`video/mp4`, `video/webm`); it does not play HLS or YouTube/Vimeo. CloudFront serves byte ranges, so seeking works
  without downloading the whole file.
- **Signed URLs, not public files.** Course pages are public, but the files are only reachable through a URL the
  platform signed. The signature is in the query string and not in the cache key, so every learner is served from
  the same cached copy.
- **CORS on the distribution.** The player reads captions with `fetch` (it draws them itself and builds the
  transcript from them), which a different origin only allows with CORS headers.
- **Cost.** S3 storage is about US$0.023 per GB-month. CloudFront's always-free tier covers 1 TB of transfer and
  10 million requests a month; beyond it, about US$0.085 per GB in North America and US$0.110 in South America.

## One-time setup

Run these from the repo root in Git Bash, with the `dalejo` profile.

### 1. Create the signing key pair, outside the repo

```bash
mkdir -p ~/.academia-media && openssl genrsa -out ~/.academia-media/media-signing.pem 2048 && openssl rsa -pubout -in ~/.academia-media/media-signing.pem -out ~/.academia-media/media-signing-public.pem
```

The private key signs URLs and goes to Amplify (step 4); the public key goes to CloudFront (step 2). Never commit
either (`*.pem` is git-ignored anyway).

### 2. Deploy the stack

```bash
aws cloudformation deploy --template-file infra/media/template.yaml --stack-name academia-media --parameter-overrides HostedZoneId=Z04257232FTAKK2T6HGOT "PublicKeyPem=$(cat ~/.academia-media/media-signing-public.pem)" --profile dalejo --region us-east-1
```

It takes 5 to 15 minutes: the certificate is validated through DNS, then the distribution is deployed.

### 3. Read the outputs

```bash
aws cloudformation describe-stacks --stack-name academia-media --profile dalejo --region us-east-1 --query "Stacks[0].Outputs" --output table
```

`BucketName`, `MediaBaseUrl` and `KeyPairId` are used below.

### 4. Give the platform the signing settings

In Amplify (app `script-playground`, **Hosting → Environment variables**), add:

| Variable | Value |
|---|---|
| `MEDIA_BASE_URL` | `https://media.academiadelcodigo.com` |
| `MEDIA_KEY_PAIR_ID` | the `KeyPairId` output |
| `MEDIA_PRIVATE_KEY_B64` | the output of `base64 -w0 ~/.academia-media/media-signing.pem` (one line) |

Then add these to the build spec (**Hosting → Build settings**), after the existing `echo` lines, so the server
can read them at runtime:

```yaml
        - echo "MEDIA_BASE_URL=$MEDIA_BASE_URL" >> .env.production
        - echo "MEDIA_KEY_PAIR_ID=$MEDIA_KEY_PAIR_ID" >> .env.production
        - echo "MEDIA_PRIVATE_KEY_B64=$MEDIA_PRIVATE_KEY_B64" >> .env.production
```

## Adding a video to a lesson

### 1. Encode it for the web

H.264 video, AAC audio, 1080p at most, with the index at the start of the file (`+faststart`) so playback starts
before the download ends:

```bash
ffmpeg -i input.mov -c:v libx264 -preset slow -crf 23 -maxrate 4500k -bufsize 9000k -vf "scale=-2:'min(1080,ih)'" -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart video.mp4
```

And a poster frame (the picture shown before play):

```bash
ffmpeg -ss 3 -i video.mp4 -frames:v 1 -q:v 3 poster.jpg
```

### 2. Upload it under a versioned folder

Files are cached for a year and never change in place: a new cut of a video goes to `v2/`, and the sidecar points
at it. The key mirrors the lesson: `courses/<course slug>/<lesson slug>/<version>/`.

```bash
aws s3 cp video.mp4 s3://<BucketName>/courses/langchain-langgraph-mastery/00-01-the-ai-engineer-role/v1/video.mp4 --content-type video/mp4 --cache-control "public, max-age=31536000, immutable" --profile dalejo
```

Posters use `--content-type image/jpeg`, captions `--content-type "text/vtt; charset=utf-8"`.

### 3. Describe it in the course repo

Beside the lesson, add `NN-MM-slug.video.json` in lk-core's format. A video with quizzes is an item group (see
the [interactive video guide](https://github.com/intellectif/learning-kit/blob/main/docs/interactive-video.md));
one with no questions yet is just the media object:

```json
{
  "type": "video",
  "url": "/media/courses/langchain-langgraph-mastery/00-01-the-ai-engineer-role/v1/video.mp4",
  "alt": "Lesson 00.01 video",
  "poster": "/media/courses/langchain-langgraph-mastery/00-01-the-ai-engineer-role/v1/poster.jpg",
  "tracks": [
    { "kind": "captions", "src": "/media/courses/langchain-langgraph-mastery/00-01-the-ai-engineer-role/v1/captions.es.vtt", "srclang": "es", "label": "Español", "default": true }
  ]
}
```

Paths start with `/media/` followed by the S3 key. The platform signs them for production; locally they are served
from `public/media/` (git-ignored), so you can try a video before uploading it.

### 4. Import

```bash
pnpm course:import --repo "<course repo>" --dry-run
```

The summary lists the lessons `with a video`. A sidecar that fails lk-core's checks stops the import and lists
every problem. Run it again without `--dry-run` to save.

## Checking it

An unsigned request is refused, which proves the bucket is closed:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://media.academiadelcodigo.com/courses/langchain-langgraph-mastery/00-01-the-ai-engineer-role/v1/video.mp4
```

Expect `403`. Then open the lesson on the platform: the video plays, and the browser's network panel shows
`media.academiadelcodigo.com` answering `206` with `Access-Control-Allow-Origin` on the captions.
