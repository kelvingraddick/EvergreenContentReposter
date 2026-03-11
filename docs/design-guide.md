# Evergreen Admin Dashboard Design Guide

## 1. Product Intent

Design a single-admin dashboard for evergreen post operations:

- Authenticate via email/password, with optional 2FA challenge.
- View, add, edit, and delete posts.
- Trigger manual publish runs for `X`, `Threads`, or both.
- Inspect run and publish outcomes with actionable error details.

This guide defines visual direction, interaction behavior, accessibility, responsive rules, and data-facing UI contracts so implementation can proceed without additional design decisions.

## 2. Visual Direction

### 2.1 Aesthetic Goal

Use an adapted minimalist style inspired by the reference image:

- Soft light page canvas.
- Dark rounded content modules.
- Low-contrast internal surfaces with subtle glow.
- Small, restrained accent chips for status or activity highlights.
- Calm motion and strict spacing rhythm.

### 2.2 Design Tokens

Use these tokens as CSS custom properties in implementation.

```css
:root {
  /* Canvas + surfaces */
  --bg-canvas: #f2f2f4;
  --bg-subtle: #ececef;
  --surface-900: #16181f;
  --surface-850: #1b1e26;
  --surface-800: #222530;
  --surface-700: #2c303b;
  --surface-overlay: rgba(8, 10, 16, 0.58);

  /* Text */
  --text-strong: #f3f5f9;
  --text-default: #d8dde8;
  --text-muted: #a3acbc;
  --text-on-canvas: #171a21;
  --text-canvas-muted: #5f6674;

  /* Accent + status */
  --accent-teal: #37d39e;
  --accent-blue: #49b6ff;
  --accent-indigo: #6f96ff;
  --accent-violet: #b88cff;
  --status-success: #2dd58f;
  --status-warning: #ffb554;
  --status-danger: #ff6b6b;
  --status-info: #57b8ff;

  /* Borders + shadows */
  --border-soft: #303543;
  --border-strong: #3c4354;
  --shadow-card: 0 16px 32px rgba(16, 18, 26, 0.18);
  --shadow-elevated: 0 18px 40px rgba(7, 9, 15, 0.28);
  --glow-subtle: 0 0 0 1px rgba(255, 255, 255, 0.03) inset;

  /* Radius */
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 20px;
  --radius-xl: 28px;
  --radius-pill: 999px;

  /* Spacing scale */
  --space-2: 0.125rem;
  --space-4: 0.25rem;
  --space-8: 0.5rem;
  --space-12: 0.75rem;
  --space-16: 1rem;
  --space-20: 1.25rem;
  --space-24: 1.5rem;
  --space-32: 2rem;
  --space-40: 2.5rem;

  /* Motion */
  --dur-fast: 140ms;
  --dur-base: 220ms;
  --dur-slow: 320ms;
  --ease-standard: cubic-bezier(0.2, 0.8, 0.2, 1);
}
```

### 2.3 Typography

- Display/UI headings: `Sora`, sans-serif.
- Body/data dense text: `IBM Plex Sans`, sans-serif.
- Numeric/tabular values: `IBM Plex Mono`, monospace.

Type scale:

- H1: `32/38`, weight `600`.
- H2: `24/30`, weight `600`.
- H3: `18/24`, weight `600`.
- Body: `14/20`, weight `400`.
- Dense table text: `13/18`, weight `400`.
- Caption/meta: `12/16`, weight `500`.

### 2.4 Iconography and Illustration

- Stroke icons, 1.75px line weight, rounded joins.
- Use simple two-tone icon treatment (text color + accent fill badge only).
- No decorative illustrations inside data-heavy views.

### 2.5 Motion

- Page load: content fades `0 -> 1` with `8px` upward translate over `220ms`.
- Card reveal: stagger by `24ms` per card, max 8 items.
- Status updates: badge flash + color transition `140ms`.
- Respect `prefers-reduced-motion: reduce` by disabling translate/stagger.

## 3. Information Architecture

## 3.1 Top-Level Navigation

Primary navigation in persistent sidebar on desktop, top tab bar on mobile:

- `Dashboard`
- `Posts`
- `Run Results`
- `Settings` (auth profile and session controls only in v1)

Global top bar contains:

- Search field (posts and runs).
- Manual publish quick action button.
- Current admin identity menu (session and sign-out).

## 3.2 Screen Map

- `/login`
- `/login/verify` (2FA challenge if enabled)
- `/dashboard`
- `/posts`
- `/posts/new`
- `/posts/:id/edit`
- `/runs`
- `/runs/:runKey`
- `/settings`

## 4. Screen Specifications

## 4.1 Login

Layout:

- Centered auth card (`420px` max width) on light canvas.
- Dark module card with elevated shadow.

Fields:

- `Email`
- `Password`
- `Remember this device` checkbox
- Primary action: `Sign in`
- Secondary link: `Forgot password` (stub allowed in v1)

Behavior:

- Client-side required-field checks.
- Server error mapped to inline alert.
- Lockout warning after 5 failed attempts in 15 minutes.
- If account requires 2FA, route to `/login/verify`.

2FA step:

- 6-digit numeric code.
- Countdown/resend state.
- Device trust toggle.
- Error state for invalid/expired code.

## 4.2 Dashboard Shell

Purpose:

- Operational overview with current queue health and recent publish outcomes.

Sections:

- KPI row (4 cards):
  - `Active Posts`
  - `Posts Eligible Now`
  - `Runs Today`
  - `Failure Rate (24h)`
- `Recent Runs` timeline card (latest 10 runs with status and source).
- `Quick Publish` rail:
  - Post selector.
  - Platform chips (`X`, `Threads`, `Both` default).
  - Optional lookback override.
  - `Trigger Publish` button.
- `Recent Failures` compact list with deep links to run details.

## 4.3 Posts Management (Ops-First Dense Table)

Primary pattern: sortable table with sticky header and row action menu.

Columns:

- `Id`
- `Status`
- `Platforms`
- `Format`
- `Weight`
- `Last Posted (X)`
- `Last Posted (Threads)`
- `Updated`
- `Actions`

Controls:

- Search by `Id`, text snippet, format.
- Filter chips: `Status`, `Platform`, `Format`.
- Bulk select for status updates and delete.
- `New Post` primary action.

Row actions:

- `Edit`
- `Duplicate`
- `Trigger Publish`
- `Delete`

Empty states:

- No posts in system.
- No results for filter/search.

## 4.4 Post Editor (Create/Edit)

Structure:

- Left panel: form fields.
- Right panel: live preview and part split inspector.

Form fields:

- `Status` (`Active`, `Inactive`)
- `Platforms` multi-select (`X`, `Threads`)
- `Format`
- `Weight`
- `Text` textarea with `---PART---` helper.

Preview behaviors:

- Show computed thread parts for Threads (500-char chunking) and X (280-char chunking).
- Highlight overflow and split boundaries.
- Warn when both platforms disabled.

Actions:

- `Save`
- `Save and trigger publish`
- `Delete` (with destructive confirmation modal)
- `Cancel`

Validation:

- Required `Text`.
- `Weight` must be numeric and >= 1.
- At least one platform selected for eligible post status.

## 4.5 Run Results

List view (`/runs`):

- Timeline-like rows ordered newest first.
- Columns: `Run Key`, `Source`, `Start`, `End`, `Result`, `Post Id`, `Actions`.
- Source badge values: `Scheduled`, `Manual`.
- Result badges: `Success`, `Partial`, `Failed`, `Skipped`.

Detail view (`/runs/:runKey`):

- Header summary card with timing and linked post.
- Per-platform result panels (`X`, `Threads`) containing:
  - success status
  - platform post id
  - deep link to published post
  - error message (if failed)
- Expandable event log stream from run artifacts.

## 5. Components and States

## 5.1 Buttons

Variants:

- `Primary` (filled, accent-blue)
- `Secondary` (surface-800 with soft border)
- `Ghost` (text-only)
- `Danger` (status-danger)

States:

- Default, hover, active, disabled, loading.
- Loading shows spinner and preserves button width.

## 5.2 Pills and Badges

- Platform pills: icon + label (`X`, `Threads`).
- Status badges:
  - `Success`: green
  - `Partial`: violet
  - `Failed`: red
  - `Skipped`: slate
  - `Running`: blue

## 5.3 Toggles and Selectors

- Segmented control for manual publish target: `X`, `Threads`, `Both`.
- Multi-select chips for post platforms.
- Date/time pickers use 24-hour internal representation; display in admin timezone.

## 5.4 Table

- Dense row height: `40px`.
- Sticky header.
- Column resizing optional, sorting required.
- Row hover uses subtle surface lift only.

## 5.5 Modals

Required modals:

- Delete confirmation.
- Publish confirmation (shows selected platforms and post id).
- Session timeout warning.

## 5.6 Toasts

Global top-right stack:

- Success, warning, error, info.
- Auto-dismiss after `5s` except error (manual dismiss).

## 5.7 System States

Every screen must define:

- `Loading` skeleton.
- `Empty` message.
- `Error` retry surface.
- `Success` confirmation where applicable.

## 6. Interaction Flows

## 6.1 Manual Publish

1. Admin clicks `Trigger Publish`.
2. Selects post and target (`X`, `Threads`, or `Both`).
3. Optional lookback override entered.
4. Confirmation modal summarizes payload.
5. Run is created with source `Manual`.
6. User is routed to run detail view with live status polling.

Failure handling:

- Platform-specific failures do not block recording other platform success.
- UI marks run `Partial` when exactly one platform fails.

## 6.2 Post CRUD Lifecycle

1. Create post with required metadata and text.
2. Save persists and returns to table with success toast.
3. Edit maintains optimistic lock indicator (last updated timestamp).
4. Delete requires explicit confirmation and post-id match prompt for destructive safety.

## 6.3 Run Investigation Flow

1. From Dashboard or Runs list, open run detail.
2. Inspect platform cards for outcome and links.
3. Expand raw error section for API messages (Threads OAuth `190`, X `401/403`, etc.).
4. Use contextual action:
   - `Retry this post`
   - `Open post editor`
   - `Copy failure details`

## 7. Accessibility and Responsive Rules

## 7.1 Accessibility

- Target WCAG 2.2 AA minimum.
- Contrast:
  - Body text >= 4.5:1.
  - Large text and UI icons >= 3:1.
- Full keyboard operation:
  - Logical tab order.
  - Visible focus ring: `2px` accent-blue + `2px` offset.
- Use `aria-live="polite"` for publish status updates.
- Status is never color-only; include icon + text labels.

## 7.2 Responsive

Breakpoints:

- `>= 1200px`: full dashboard with side nav and two-column panels.
- `768px - 1199px`: compact side rail, cards stack in two columns.
- `< 768px`: top tab nav, single-column cards, table switches to card-list mode.

Mobile adaptations:

- Keep manual publish action persistent as bottom sticky button.
- Row actions collapse into kebab menu.
- Run detail panels become accordion sections.

## 8. Data Contracts for UI Layer

These view models should be implemented in the frontend API adapter layer.

```ts
export type Role = "admin";

export interface AuthSession {
  userId: string;
  email: string;
  role: Role;
  twoFactorEnabled: boolean;
  twoFactorVerified: boolean;
  sessionExpiresAt: string; // ISO-8601 UTC timestamp
}

export type Platform = "x" | "threads";
export type PostStatus = "Active" | "Inactive";

export interface PostViewModel {
  recordId: string; // Airtable RECORD_ID()
  id: number; // Airtable {Id}
  status: PostStatus;
  platforms: Platform[];
  format: string;
  text: string;
  weight: number;
  lastPostedOnXTime?: string; // ISO-8601
  lastPostedOnThreadsTime?: string; // ISO-8601
  updatedAt?: string; // derived from Airtable metadata when available
}

export type RunResult = "Success" | "Partial" | "Failed" | "Skipped";
export type RunSource = "Scheduled" | "Manual";

export interface JobRunViewModel {
  runKey: string;
  source: RunSource;
  startTime: string; // ISO-8601
  endTime?: string; // ISO-8601
  result: RunResult;
  postRecordId?: string;
  postId?: number;
}

export interface PublishAttemptViewModel {
  runKey: string;
  platform: Platform;
  isSuccess: boolean;
  platformPostId?: string;
  platformPostLink?: string;
  errorMessage?: string;
  startedAt?: string; // inherited from job start
  finishedAt?: string; // inherited from job end
}

export interface ManualPublishRequest {
  postIdentifier: string | number; // rec... or numeric Id
  targets: Platform[]; // ["x"], ["threads"], or ["x", "threads"]
  lookbackDaysOverride?: number;
}
```

Mapping notes to existing backend:

- `PostViewModel` maps to `Posts` table fields in current schema.
- `JobRunViewModel` maps to `Jobs`.
- `PublishAttemptViewModel` maps to `Published`.
- `ManualPublishRequest.postIdentifier` aligns with existing direct-post behavior.

## 9. QA and Acceptance Criteria

## 9.1 Visual QA Checklist

- Correct token usage on all screens.
- Dark modules on light canvas with consistent radii/shadows.
- Typography hierarchy preserved for dense data and headers.
- Motion follows duration/easing tokens and reduced-motion fallback.

## 9.2 UX Task Scenarios

- Login success and failure flows (with optional 2FA).
- Create, edit, delete post.
- Trigger manual publish for:
  - X only
  - Threads only
  - Both platforms
- Inspect successful and failed run details.

## 9.3 Accessibility QA

- Keyboard-only completion for all key operations.
- Focus ring always visible and not clipped.
- Screen reader labels for form fields, row actions, status badges.
- Live status announcements for run updates.

## 9.4 Responsive QA

- Desktop dense-table behavior and sticky header.
- Tablet filter/action usability.
- Mobile card-list readability and action discoverability.

## 10. v1 Assumptions

- Single admin role only.
- Email/password auth with optional 2FA UX pattern.
- Manual publish may override platform targets per run.
- Airtable remains source of truth.
- This document is the implementation-facing design spec for frontend build.
