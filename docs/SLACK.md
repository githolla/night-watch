# Slack command center

Slack is Night Watch's recommended operating surface. Gmail remains optional: the bot delivers the morning desk, links every recommendation to its public source and full dossier, and records human actions and outcomes back into Supabase.

## 1. Create the Slack app

1. Open [Your Slack Apps](https://api.slack.com/apps), choose **Create New App**, then **From an app manifest**.
2. Copy `docs/slack-app-manifest.yml` into the manifest editor.
3. Replace `YOUR-NIGHT-WATCH-DOMAIN` in both URLs with the production Vercel domain, without a trailing slash.
4. Create the app and choose **Install to Workspace**.

The manifest asks only for `chat:write` and `commands`. Night Watch does not read channel history, DMs, files, or workspace members.

## 2. Add the Vercel variables

In Vercel, open **Project → Settings → Environment Variables** and add these to Production and Preview:

| Variable | Where to find it |
| --- | --- |
| `SLACK_BOT_TOKEN` | Slack app → OAuth & Permissions → Bot User OAuth Token (`xoxb-…`) |
| `SLACK_SIGNING_SECRET` | Slack app → Basic Information → App Credentials → Signing Secret |
| `SLACK_CHANNEL_ID` | Open the target Slack channel → channel details → copy channel ID |
| `APP_URL` | The production Vercel URL, such as `https://night-watch.example.com` |

Optional controls:

- `SLACK_ALLOWED_USER_IDS`: comma-separated Slack member IDs allowed to change dossiers. Leave blank to allow any member who can use the app in the channel.
- `SLACK_JOSH_USER_ID`: Josh's Slack user id, for the allowlist. Every click is recorded as Josh.

Redeploy after adding the variables.

## 3. Add the bot to the channel

In Slack, open the chosen channel and run `/invite @Night Watch`. A private channel must explicitly invite the bot. Then open Night Watch **Settings → Slack command center → Send test brief**.

## How it works

- The existing Vercel morning cron posts the desk at 12:00 UTC (08:00 Eastern during daylight-saving time).
- `/night-watch` or `/night-watch brief` returns the five highest-scoring dossiers privately to the requester.
- **Approve**, **Snooze 7d**, and **Dismiss** update the same `cards` records used by the web app.
- **I sent LinkedIn** and **I sent email** record manual touches. They do not send anything automatically.
- **Record outcome** feeds reply and meeting results into Learning analytics and stops an active cadence.
- Every inbound Slack request is HMAC-SHA256 verified with the signing secret and rejected when older than five minutes.

Night Watch never sends email or LinkedIn messages from Slack. The controls record decisions and manual actions; the full dossier remains the place to edit message copy and inspect all evidence.
