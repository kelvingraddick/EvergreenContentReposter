# Evergreen Content Reposter

Automation for posting evergreen content from AirTable to Threads and X using GitHub Actions.

## How it works
- GitHub Actions runs on a schedule (see `.github/workflows/scheduler.yml`).
- The workflow cron is set in UTC for two runs per day.
- Each run creates a record in `Jobs` and two records in `Published` (Threads and X).
- A post is eligible only if:
  - `Status` is `Active`
  - `Platforms` includes both `Threads` and `X`
  - `LastPostedOnThreadsTime` is blank or at least `LOOKBACK_DAYS` old
  - `LastPostedOnXTime` is blank or at least `LOOKBACK_DAYS` old
- Weighted random selection uses the `Weight` field.

## AirTable schema
This repo expects three tables in your base.

### Posts
- Id (Autonumber)
- Status (Single select)
- Platforms (Multiple select)
- Format (Single select)
- Text (Long text)
- Weight (Number)
- LastPostedOnThreadsTime (Date)
- LastPostedOnXTime (Date)
- Jobs (Link to another record)

Threads and X threads use a delimiter in `Text`:
- Split parts using `---PART---`

### Jobs
- Id (Autonumber)
- RunKey (Single line text)
- StartTime (Date)
- EndTime (Date)
- Post (Link to Posts)
- Published (Link to Published)
- Result (Single select)
- PostId (Lookup)
- PostText (Lookup)

### Published
- Id (Autonumber)
- Job (Link to Jobs)
- Platform (Single select)
- IsSuccess (Checkbox)
- ErrorMessage (Long text)
- PlatformPostId (Single line text)
- JobStartTime (Lookup)
- JobEndTime (Lookup)
- JobPost (Lookup)
- JobPostId (Lookup)
- JobPostText (Lookup)

## Environment variables and GitHub secrets
Set these in GitHub Actions secrets or your shell.

### AirTable
- AIRTABLE_TOKEN
- AIRTABLE_BASE_ID
- AIRTABLE_POSTS_TABLE (defaults to Posts)
- AIRTABLE_JOBS_TABLE (defaults to Jobs)
- AIRTABLE_PUBLISHED_TABLE (defaults to Published)

### Threads
- THREADS_USER_ID
- THREADS_ACCESS_TOKEN
- THREADS_USERNAME (optional, used for fallback link construction)
- THREADS_DISABLE_AUTO_REFRESH (optional, set `true` to skip refresh attempt)

Notes:
- This app now attempts `th_refresh_token` before posting.
- If Meta returns OAuth code `190`, your token is expired/invalid and you must replace `THREADS_ACCESS_TOKEN` in GitHub secrets.
- On successful publish, the app now prefers the API `permalink` for log output (canonical `https://www.threads.com/@.../post/...` URL).

### X
- X_CONSUMER_KEY
- X_CONSUMER_SECRET
- X_ACCESS_TOKEN
- X_ACCESS_TOKEN_SECRET

Notes:
- X posting uses OAuth 1.0a user context only.
- Ensure your X app has read/write permissions for the posting account.

### Scheduling
- LOOKBACK_DAYS (defaults to 90)

Workflow schedule is configured in `.github/workflows/scheduler.yml` using UTC cron:
- Use `0 12,20 * * *` for 08:00 and 16:00 America/New_York during EDT (UTC-4).
- Use `0 13,21 * * *` for 08:00 and 16:00 America/New_York during EST (UTC-5).
- Update this at DST boundaries (for 2026: switch to EDT hours on March 8, 2026; switch to EST hours on November 1, 2026).

## Run locally
```bash
npm ci
node src/run.js
```

You can also run the workflow manually from the Actions tab:
- Open `Evergreen scheduler`.
- Click `Run workflow`.
- Optionally set `lookback_days` for that run (defaults to `90`).
- Optionally set `post_id` to directly publish a specific post by Airtable record ID (`rec...`) or numeric `{Id}`.
- Optionally set `target_platforms` to `threads,x` (default), `threads`, or `x`.

### Direct post override
Use `DIRECT_POST_ID` (or CLI `--post-id`) to bypass weighted selection and post one specific record.
Use `DIRECT_TARGET_PLATFORMS` (or CLI `--targets`) to control publish targets.

Examples:
```bash
DIRECT_POST_ID=rec1234567890abc node src/run.js
node src/run.js --post-id 42
DIRECT_POST_ID=rec1234567890abc DIRECT_TARGET_PLATFORMS=x node src/run.js
node src/run.js --post-id 42 --targets threads
```

Notes:
- `DIRECT_POST_ID` accepts an Airtable record ID (`rec...`) or numeric `Id` field from `Posts`.
- `DIRECT_TARGET_PLATFORMS` accepts `threads`, `x`, or comma-separated values (`threads,x`).
- When set, cooldown eligibility filters are skipped for selection; the chosen post is posted immediately.
- Successful publishes still update `LastPostedOnThreadsTime` and `LastPostedOnXTime`.

## GitHub Pages admin dashboard
This repo includes a static admin dashboard in `docs/` that can be hosted on GitHub Pages.

Features:
- Login/session gate with optional TOTP verification step.
- Post management (view/add/edit/delete) via Airtable API.
- Manual publish dispatch to GitHub Actions (`X`, `Threads`, or both).
- Run + publish attempt visibility from `Jobs` and `Published`.

Deploy:
1. In GitHub repo settings, enable Pages and select `Deploy from a branch`.
2. Use your default branch and the `/docs` folder.
3. Open the published Pages URL and sign in with your Airtable/GitHub credentials.

Important:
- GitHub Pages is static hosting; credentials are used client-side in your browser session.
- Use a dedicated least-privilege Airtable token and GitHub token.

## Notes
- This repo currently posts text only.
- Threads posting uses `auto_publish_text` for simple text threads, and reply chaining via `reply_to_id`.
- Cooldowns are tracked per platform to avoid reposting the same post within the lookback window.
- Threads success logs include canonical post links when available; if permalink lookup is unavailable, fallback links are generated.
