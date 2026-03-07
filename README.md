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

Note: Threads tokens expire. Refreshing requires app credentials and the threads token exchange and refresh endpoints.

### X
- X_BEARER_TOKEN

The X implementation in this repo is a placeholder. Add OAuth 2 user context auth and post creation logic in `src/platforms/x.js`.

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

## Notes
- This repo currently posts text only.
- Threads posting uses `auto_publish_text` for simple text threads, and reply chaining via `reply_to_id`.
- Cooldowns are tracked per platform to avoid reposting the same post within the lookback window.
