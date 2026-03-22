# Setup Guide

This file shows exactly where each value goes.

## 1. Put your secrets in one place

For local testing:

1. Copy [`.env.example`](/d:/Scheduled/Car-Reels/.env.example) to `.env`
2. Replace every placeholder value with your real one

For Vercel:

1. Open your project
2. Go to `Settings -> Environment Variables`
3. Add the same values there

Keep `.env.example` as placeholders only. Put real secrets in `.env` locally and in Vercel for production.

If you use Instagram Login on Vercel, also set:

- `APP_BASE_URL=https://your-project.vercel.app`
- `MEDIA_PROXY_SECRET=any-long-secret`

## 2. Google Drive folder ID

This goes in:

- `GOOGLE_DRIVE_SOURCE_FOLDER_ID`

Optional separate tracker folder:

- `GOOGLE_DRIVE_STATE_FOLDER_ID`

How to find it:

1. Open your Drive folder in the browser
2. Look at the URL
3. Example:

```text
https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz
```

The folder ID is:

```text
1AbCdEfGhIjKlMnOpQrStUvWxYz
```

## 3. Instagram professional account ID

This goes in:

- `INSTAGRAM_USER_ID`

Important:

- this must be the numeric Instagram professional account ID
- do not put your `@username` here

You can get it automatically after login by setting `META_USER_ACCESS_TOKEN` and running:

```bash
npm run meta:resolve
```

Or pass the token directly without editing env:

```bash
npm run meta:resolve -- --token YOUR_META_USER_TOKEN --page-name "Your Page Name"
```

If you already have a Page access token, you can usually fetch it from:

```text
GET https://graph.facebook.com/v25.0/me/accounts?access_token=YOUR_TOKEN
```

Then fetch the connected Instagram account from the Page.

## 4. Meta access token

This goes in:

- `INSTAGRAM_PAGE_ACCESS_TOKEN` for Facebook Login
- `META_USER_ACCESS_TOKEN` for Instagram Login tokens that start with `IG...`

Important:

- it must be a token that can publish to the Facebook Page connected to your Instagram professional account
- normal Instagram login cookies are not enough
- if you only have a temporary Meta user token, put it in `META_USER_ACCESS_TOKEN` and run `npm run meta:resolve`

If you are using Instagram Login:

- set `INSTAGRAM_AUTH_MODE=instagram-login`
- keep the generated token in `META_USER_ACCESS_TOKEN`
- use the numeric `INSTAGRAM_USER_ID` printed by `npm run meta:resolve`
- deploy the app publicly so `/api/media` can proxy the Drive video to Instagram

## 5. Groq API key

This goes in:

- `GROQ_API_KEY`

Base URL is already set to:

```text
https://api.groq.com/openai/v1
```

## 6. Channel config file in Drive

Inside your Drive source folder, upload a file called:

```text
channel-config.json
```

Start by copying [channel-config.example.json](/d:/Scheduled/Car-Reels/channel-config.example.json).

That file controls:

- post timing
- timezone
- caption mode
- hashtag style
- queue order
- posted tracking behavior

Important for real automation:

- the Google service account needs `Editor` access on the source folder
- if you use a separate tracker folder, the service account also needs `Editor` access there
- viewer access is not enough because the default setup writes `.car-reels-state.json` after each successful post

## 7. Local run

After `.env` is filled:

```bash
npm install
npm run status
npm run preview
```

For a real live post with `INSTAGRAM_AUTH_MODE=instagram-login`, use the deployed Vercel app instead of a purely local run, because Instagram needs a public URL for `/api/media`.

## 8. Vercel run

After you deploy:

- `/api/status` needs `Authorization: Bearer <ADMIN_API_SECRET>`
- `/api/manual?mode=preview` needs `Authorization: Bearer <ADMIN_API_SECRET>`
- `/api/cron` needs `Authorization: Bearer <CRON_SECRET>`

If you want 5-hour automation without Vercel Pro, use the GitHub Actions workflow in [`.github/workflows/trigger-vercel-cron.yml`](/d:/Scheduled/Car-Reels/.github/workflows/trigger-vercel-cron.yml) and add these GitHub repo secrets:

- `CRON_ENDPOINT_URL=https://car-reels-automation.vercel.app/api/cron`
- `CRON_SECRET=your-cron-secret`

## 9. What you absolutely must fill

These are the non-negotiable ones:

- `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
- `GOOGLE_DRIVE_SOURCE_FOLDER_ID`
- `INSTAGRAM_USER_ID`
- `INSTAGRAM_PAGE_ACCESS_TOKEN` or `META_USER_ACCESS_TOKEN`
- `CRON_SECRET`
- `ADMIN_API_SECRET`

Groq is strongly recommended if you want AI-written captions:

- `GROQ_API_KEY`
