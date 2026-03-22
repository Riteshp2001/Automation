# Car Reels Automation

This project gives you a Vercel-hosted automation backend that:

- Reads queued videos from a Google Drive folder
- Loads a dynamic JSON config file from that same Drive folder
- Builds luxury-lifestyle captions and hashtags automatically with Groq or template fallback
- Uploads the video to Instagram as a Reel through Meta's official publishing API
- Keeps track of what has already been posted without needing to remove the source videos

The app now supports both official Meta auth paths:

- `facebook-login`: Facebook Page access token + connected Instagram professional account
- `instagram-login`: Instagram Login user token on `graph.instagram.com`

When using `instagram-login`, the app serves a signed `/api/media` URL from your own Vercel deployment so Instagram can fetch the Drive video without relying on Google Drive's bot-blocked download URLs.

## What makes it dynamic

You do not need to redeploy just to change the posting behavior. Update `channel-config.json` in Drive and the next run will pick up:

- posting schedule
- timezone
- queue order
- whether posted files are tracked by state file or moved to archive
- caption tone
- CTA line
- hashtag set
- archive and processing folders
- dry-run mode

Use [channel-config.example.json](./channel-config.example.json) as your starting point.

## File flow

1. Put new videos in your source Drive folder.
2. The app finds the next eligible video.
3. It creates a processing container on Instagram.
4. It either streams the video to Meta or gives Instagram a signed media URL, depending on the auth mode.
5. After publish succeeds, it marks that Drive item as posted in `.car-reels-state.json` by default, so the next run picks the next video while leaving the originals in place.

## Required environment variables

Set these in Vercel Project Settings:

- `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
- `GOOGLE_DRIVE_SOURCE_FOLDER_ID`
- `INSTAGRAM_USER_ID`
- `INSTAGRAM_PAGE_ACCESS_TOKEN` or `META_USER_ACCESS_TOKEN`
- `CRON_SECRET`
- `ADMIN_API_SECRET`

Optional:

- `GROQ_API_KEY`
- `GOOGLE_DRIVE_ARCHIVE_FOLDER_ID`
- `GOOGLE_DRIVE_PROCESSING_FOLDER_ID`
- `GOOGLE_DRIVE_STATE_FOLDER_ID`
- `GOOGLE_DRIVE_CONFIG_FILE_ID`
- `GOOGLE_DRIVE_CONFIG_FILE_NAME`
- `GOOGLE_DRIVE_SHARED_DRIVE_ID`
- `DEFAULT_SCHEDULE_CRON`
- `DEFAULT_TIMEZONE`
- `DEFAULT_CAPTION_MODE`
- `META_API_VERSION`
- `INSTAGRAM_AUTH_MODE`
- `META_USER_ACCESS_TOKEN`
- `META_TARGET_PAGE_NAME`
- `META_TARGET_PAGE_ID`
- `APP_BASE_URL`
- `MEDIA_PROXY_SECRET`
- `GROQ_BASE_URL`
- `GROQ_MODEL`
- `GROQ_TIMEOUT_MS`
- `ENABLE_UPLOADS`
- `MAX_UPLOAD_RETRIES`
- `MAX_VIDEO_SIZE_MB`
- `STATUS_POLL_ATTEMPTS`
- `STATUS_POLL_INTERVAL_MS`

## Drive setup

1. Create or choose a Drive folder for queued videos.
2. Share that folder with the Google service account email from your JSON key.
3. Upload `channel-config.json` into the same folder.
4. Upload videos into the folder whenever you want them queued.

If you want to keep tracking separate from the video queue:

- set `GOOGLE_DRIVE_SOURCE_FOLDER_ID` to the reels folder
- set `GOOGLE_DRIVE_STATE_FOLDER_ID` to a separate tracker folder
- the app will read videos from the source folder and store `.car-reels-state.json` in the tracker folder

## Instagram setup

This uses Meta's official Instagram content publishing flow for professional accounts. Your account must be:

- an Instagram professional account
- connected to a Facebook Page
- authorized through Meta's publishing permissions

If your token starts with `IG...`, you are usually using Instagram Login. In that case:

- set `INSTAGRAM_AUTH_MODE=instagram-login`
- set `META_USER_ACCESS_TOKEN` to your Instagram token
- set `INSTAGRAM_USER_ID` to the numeric ID from `npm run meta:resolve`
- the app will publish through `graph.instagram.com`

If you only have a Meta user token after logging in, the repo can resolve the final publish credentials for you:

1. Put the temporary user token in `META_USER_ACCESS_TOKEN`
2. Optionally set `META_TARGET_PAGE_NAME` if you manage more than one Page
3. Run `npm run meta:resolve`

That command will inspect the token, find the connected Page + Instagram account, and print the exact `INSTAGRAM_PAGE_ACCESS_TOKEN` and numeric `INSTAGRAM_USER_ID` to paste back into your env.

You can also skip editing env and pass a fresh token directly:

```bash
npm run meta:resolve -- --token YOUR_META_USER_TOKEN --page-name "Your Page Name"
```

## Vercel deployment

1. Run `npm install`.
2. Push the repo to GitHub.
3. Import it into Vercel.
4. Add the environment variables.
5. Deploy.

For unattended automation, the Google service account must have `Editor` access on the source Drive folder. Read-only access is enough for previews, but not enough to move processed files into `_processing` and `_posted`.
For the default `state-file` setup, the service account still needs `Editor` access so it can create and update `.car-reels-state.json` in the source folder.

If you want the easiest setup path, follow [SETUP.md](./SETUP.md) and fill [`.env.example`](./.env.example) first.

## Groq captions

This repo is now set up to use Groq's OpenAI-compatible endpoint:

```text
https://api.groq.com/openai/v1
```

Recommended settings:

- `GROQ_API_KEY`
- `GROQ_MODEL=openai/gpt-oss-20b`
- `DEFAULT_CAPTION_MODE=hybrid`

`hybrid` means:

- try Groq first
- fall back to the built-in luxury template if Groq is missing, rate-limited, or errors

You can also override the behavior from `channel-config.json`:

```json
{
  "captions": {
    "mode": "groq",
    "fallbackToTemplate": true,
    "model": "openai/gpt-oss-20b",
    "temperature": 0.9
  }
}
```

### Scheduling options

`/api/cron` is the endpoint that performs the scheduled run.

If you are on a Vercel plan that supports frequent cron expressions, use [vercel.pro-cron.example.json](./vercel.pro-cron.example.json) as your template and trigger `/api/cron` every minute. The app will then decide whether the current minute matches the cron expression inside `channel-config.json`.

If you are on Vercel Hobby, keep this app hosted on Vercel but trigger `/api/cron` from an external scheduler with the header:

```text
Authorization: Bearer <CRON_SECRET>
```

That keeps the backend on Vercel while still allowing 3-hourly, 5-hourly, 6-hourly, or other custom schedules.

If your Drive tracker folder is read-only, use the GitHub Actions workflow in [`.github/workflows/run-automation.yml`](./.github/workflows/run-automation.yml) instead. It:

- runs every 5 hours on GitHub Actions
- reads the next video from Drive
- uses your Vercel deployment only for the signed `/api/media` proxy
- stores posted history in `.automation/posting-state.json` in the repo
- commits that state file automatically after each successful post

GitHub Actions schedules run in UTC, so the workflow is already set to match `0 */5 * * *` in `Asia/Kolkata`.

## Manual endpoints

- `GET /api/status`
- `GET /api/manual?mode=preview`
- `POST /api/manual`

All manual and status endpoints should be called with:

```text
Authorization: Bearer <ADMIN_API_SECRET>
```

Send JSON like this to `POST /api/manual`:

```json
{
  "mode": "run",
  "force": true,
  "dryRun": false,
  "fileId": "optional-drive-file-id"
}
```

## Local commands

Create a local `.env` file first by copying `.env.example`.

- `npm run status`
- `npm run preview`
- `npm run run`

If you are using `instagram-login`, real live posting should be done from the deployed Vercel app because Instagram needs a public `APP_BASE_URL` for the signed `/api/media` proxy.

## Notes

- The config file is read on every run, so changing it in Drive changes the behavior immediately.
- The app supports both streamed uploads and signed public proxy URLs.
- The default queue mode is `state-file`, so source videos stay where they are and the app tracks posted items in Drive with `.car-reels-state.json`.
- Caption generation can run in `template`, `groq`, or `hybrid` mode without code changes.
- Large videos can still hit platform duration limits, so keep Reel files lean and production-ready.
- Keep real secrets in `.env` or Vercel env vars, not in `.env.example`.
