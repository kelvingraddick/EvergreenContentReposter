const STORAGE_KEYS = {
  SESSION: "ecr_dashboard_session_v1",
  PROFILE: "ecr_dashboard_profile_v1",
};

const DEFAULTS = {
  postsTable: "Posts",
  jobsTable: "Jobs",
  publishedTable: "Published",
  workflow: "scheduler.yml",
  ref: "main",
  lookbackDays: 90,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
};
const RUNS_POLL_INTERVAL_MS = 20_000;
const RUNS_POLL_MAX_DURATION_MS = 15 * 60 * 1000;

const appEl = document.getElementById("app");

const state = {
  session: loadSession(),
  pendingAuth: null,
  search: "",
  route: parseRoute(location.hash),
  loading: false,
  posting: false,
  savingPost: false,
  data: {
    posts: [],
    jobs: [],
    published: [],
    loadedAt: null,
  },
  postsFilter: {
    status: "all",
    platform: "all",
    format: "all",
  },
  modal: null,
  toasts: [],
  polling: {
    enabled: false,
    intervalMs: RUNS_POLL_INTERVAL_MS,
    stopAt: 0,
    timerId: null,
    inFlight: false,
    lastErrorAt: 0,
  },
};

init();

function init() {
  bindGlobalEvents();
  if (state.session) {
    refreshData({ silent: false }).catch((err) => {
      pushToast(cleanError(err), "error", 7000);
    });
  }
  render();
}

function bindGlobalEvents() {
  window.addEventListener("hashchange", () => {
    state.route = parseRoute(location.hash);
    if (state.polling.enabled && isRunsRoute()) {
      scheduleRunsPolling(450);
    }
    render();
  });

  document.addEventListener("click", handleGlobalClick);
  document.addEventListener("submit", handleGlobalSubmit);
  document.addEventListener("input", handleGlobalInput);
  document.addEventListener("change", handleGlobalInput);
}

function parseRoute(hash) {
  const raw = (hash || "#/dashboard").replace(/^#/, "");
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return { page: "dashboard" };

  if (parts[0] === "login") return { page: "login", step: parts[1] || "base" };
  if (parts[0] === "dashboard") return { page: "dashboard" };
  if (parts[0] === "posts" && parts[1] === "new") return { page: "postEditor", mode: "new" };
  if (parts[0] === "posts" && parts[2] === "edit") {
    return { page: "postEditor", mode: "edit", recordId: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "posts") return { page: "posts" };
  if (parts[0] === "runs" && parts[1]) return { page: "runDetail", runKey: decodeURIComponent(parts[1]) };
  if (parts[0] === "runs") return { page: "runs" };
  if (parts[0] === "settings") return { page: "settings" };
  return { page: "dashboard" };
}

function navigate(path) {
  const safe = path.startsWith("#") ? path : `#${path}`;
  if (location.hash === safe) {
    state.route = parseRoute(safe);
    render();
    return;
  }
  location.hash = safe;
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.SESSION);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.auth?.sessionExpiresAt) return null;
    if (Date.now() > new Date(parsed.auth.sessionExpiresAt).getTime()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(session) {
  sessionStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
}

function clearSession() {
  stopRunsPolling();
  sessionStorage.removeItem(STORAGE_KEYS.SESSION);
  state.session = null;
  state.pendingAuth = null;
  state.data = { posts: [], jobs: [], published: [], loadedAt: null };
}

function isRunsRoute() {
  return state.route.page === "runs" || state.route.page === "runDetail";
}

function pollingStatusText() {
  if (!state.polling.enabled) return "Live updates off";
  const remainingMs = Math.max(0, state.polling.stopAt - Date.now());
  const remainingMin = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `Live updates every 20s (${remainingMin}m left)`;
}

function startRunsPolling({ durationMs = RUNS_POLL_MAX_DURATION_MS, immediate = true } = {}) {
  state.polling.enabled = true;
  state.polling.stopAt = Date.now() + durationMs;
  scheduleRunsPolling(immediate ? 250 : state.polling.intervalMs);
  render();
}

function stopRunsPolling({ notify = false } = {}) {
  state.polling.enabled = false;
  state.polling.stopAt = 0;
  state.polling.inFlight = false;
  state.polling.lastErrorAt = 0;
  if (state.polling.timerId) {
    clearTimeout(state.polling.timerId);
    state.polling.timerId = null;
  }
  if (notify) pushToast("Live run updates paused.", "info");
}

function scheduleRunsPolling(delayMs = state.polling.intervalMs) {
  if (!state.polling.enabled || !state.session) return;
  if (state.polling.timerId) clearTimeout(state.polling.timerId);
  state.polling.timerId = setTimeout(() => {
    tickRunsPolling().catch((err) => {
      const now = Date.now();
      if (!state.polling.lastErrorAt || now - state.polling.lastErrorAt >= 60_000) {
        pushToast(cleanError(err), "error");
        state.polling.lastErrorAt = now;
      }
      scheduleRunsPolling();
    });
  }, Math.max(0, delayMs));
}

async function tickRunsPolling() {
  state.polling.timerId = null;
  if (!state.polling.enabled || !state.session) return;
  if (Date.now() >= state.polling.stopAt) {
    stopRunsPolling();
    pushToast("Live run updates ended after 15 minutes.", "info");
    render();
    return;
  }
  if (!isRunsRoute()) {
    scheduleRunsPolling();
    return;
  }
  if (state.polling.inFlight) {
    scheduleRunsPolling();
    return;
  }

  state.polling.inFlight = true;
  try {
    await refreshData({ silent: true });
  } finally {
    state.polling.inFlight = false;
  }
  scheduleRunsPolling();
}

function getSavedProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PROFILE);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function saveProfile(profile) {
  localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(profile));
}

function render() {
  if (!state.session) {
    if (state.route.page !== "login") navigate("/login");
    renderLogin();
    renderOverlays();
    return;
  }

  if (Date.now() > new Date(state.session.auth.sessionExpiresAt).getTime()) {
    clearSession();
    pushToast("Session expired. Sign in again.", "warning");
    render();
    return;
  }

  if (state.route.page === "login") {
    navigate("/dashboard");
    return;
  }

  renderAuthedApp();
  renderOverlays();
}

function renderLogin() {
  const profile = getSavedProfile();
  const isVerify = state.route.step === "verify";
  const pending = state.pendingAuth;

  if (isVerify && !pending) {
    navigate("/login");
    return;
  }

  appEl.innerHTML = `
    <div class="login-wrap">
      <div class="card login-card" aria-live="polite">
        <section class="login-side">
          <h1>Evergreen Ops</h1>
          <p class="muted">
            Client-side admin dashboard for Posts, manual publish, and run visibility.
          </p>
          <div class="hr"></div>
          <p class="muted help">
            Security note: GitHub Pages is static hosting. This login is a browser session gate and not a server-backed identity provider.
          </p>
        </section>
        <section class="login-form">
          ${
            isVerify
              ? renderVerifyForm()
              : renderSignInForm(profile)
          }
        </section>
      </div>
    </div>
  `;
}

function renderSignInForm(profile) {
  return `
    <h2>Sign in</h2>
    <p class="help">Enter operator identity and API credentials for Airtable + GitHub Actions.</p>
    <form id="login-form" autocomplete="off">
      <div class="field">
        <label for="email">Email</label>
        <input id="email" class="input" name="email" type="email" required value="${escapeHtml(profile.email || "")}" />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" class="input" name="password" type="password" required value="" />
      </div>
      <div class="field">
        <label for="totpSecret">2FA shared secret (optional TOTP base32)</label>
        <input id="totpSecret" class="input mono" name="totpSecret" type="text" value="${escapeHtml(profile.totpSecret || "")}" />
      </div>

      <div class="hr"></div>

      <h3>Connectors</h3>
      <div class="field">
        <label for="airtableToken">Airtable token</label>
        <input id="airtableToken" class="input mono" name="airtableToken" type="password" required value="${escapeHtml(profile.airtableToken || "")}" />
      </div>
      <div class="field">
        <label for="airtableBaseId">Airtable base ID</label>
        <input id="airtableBaseId" class="input mono" name="airtableBaseId" type="text" required value="${escapeHtml(profile.airtableBaseId || "")}" />
      </div>
      <div class="split">
        <div class="field">
          <label for="postsTable">Posts table</label>
          <input id="postsTable" class="input" name="postsTable" type="text" value="${escapeHtml(profile.postsTable || DEFAULTS.postsTable)}" />
        </div>
        <div class="field">
          <label for="jobsTable">Jobs table</label>
          <input id="jobsTable" class="input" name="jobsTable" type="text" value="${escapeHtml(profile.jobsTable || DEFAULTS.jobsTable)}" />
        </div>
      </div>
      <div class="field">
        <label for="publishedTable">Published table</label>
        <input id="publishedTable" class="input" name="publishedTable" type="text" value="${escapeHtml(profile.publishedTable || DEFAULTS.publishedTable)}" />
      </div>
      <div class="field">
        <label for="threadsUsername">Threads username (optional, for links)</label>
        <input id="threadsUsername" class="input" name="threadsUsername" type="text" value="${escapeHtml(profile.threadsUsername || "")}" />
      </div>

      <div class="hr"></div>

      <div class="field">
        <label for="githubToken">GitHub token (workflow dispatch)</label>
        <input id="githubToken" class="input mono" name="githubToken" type="password" required value="${escapeHtml(profile.githubToken || "")}" />
      </div>
      <div class="split">
        <div class="field">
          <label for="githubOwner">Repo owner</label>
          <input id="githubOwner" class="input" name="githubOwner" type="text" required value="${escapeHtml(profile.githubOwner || "")}" />
        </div>
        <div class="field">
          <label for="githubRepo">Repo name</label>
          <input id="githubRepo" class="input" name="githubRepo" type="text" required value="${escapeHtml(profile.githubRepo || "")}" />
        </div>
      </div>
      <div class="split">
        <div class="field">
          <label for="workflow">Workflow file or ID</label>
          <input id="workflow" class="input" name="workflow" type="text" value="${escapeHtml(profile.workflow || DEFAULTS.workflow)}" />
        </div>
        <div class="field">
          <label for="workflowRef">Workflow ref (branch/tag)</label>
          <input id="workflowRef" class="input" name="workflowRef" type="text" value="${escapeHtml(profile.workflowRef || DEFAULTS.ref)}" />
        </div>
      </div>
      <div class="split">
        <div class="field">
          <label for="lookbackDays">Default lookback days</label>
          <input id="lookbackDays" class="input" name="lookbackDays" type="number" min="1" value="${escapeHtml(String(profile.lookbackDays || DEFAULTS.lookbackDays))}" />
        </div>
        <div class="field">
          <label for="timezone">Timezone</label>
          <input id="timezone" class="input" name="timezone" type="text" value="${escapeHtml(profile.timezone || DEFAULTS.timezone)}" />
        </div>
      </div>

      <div class="field">
        <label><input type="checkbox" name="rememberProfile" ${profile.rememberProfile ? "checked" : ""} /> Remember profile on this browser</label>
      </div>
      <div class="field">
        <label><input type="checkbox" name="rememberSecrets" ${profile.rememberSecrets ? "checked" : ""} /> Remember API secrets on this browser (not recommended)</label>
      </div>

      <div class="btn-row">
        <button type="submit" class="btn btn-primary">Sign in</button>
      </div>
    </form>
  `;
}

function renderVerifyForm() {
  const email = state.pendingAuth?.identity?.email || "operator";
  return `
    <h2>Verify 2FA</h2>
    <p class="help">Enter the current 6-digit authenticator code for ${escapeHtml(email)}.</p>
    <form id="verify-form" autocomplete="off">
      <div class="field">
        <label for="otpCode">One-time code</label>
        <input id="otpCode" class="input mono" name="otpCode" type="text" pattern="[0-9]{6}" maxlength="6" inputmode="numeric" required />
      </div>
      <div class="btn-row">
        <button type="submit" class="btn btn-primary">Verify</button>
        <button type="button" class="btn btn-secondary" data-action="back-login">Back</button>
      </div>
    </form>
  `;
}

function renderAuthedApp() {
  const route = state.route.page;
  const runsRoute = isRunsRoute();
  const titleMap = {
    dashboard: "Dashboard",
    posts: "Posts",
    postEditor: state.route.mode === "edit" ? "Edit Post" : "New Post",
    runs: "Run Results",
    runDetail: "Run Details",
    settings: "Settings",
  };

  appEl.innerHTML = `
    <div class="app-shell">
      <aside class="side-nav" aria-label="Primary navigation">
        <div class="brand">Evergreen Ops</div>
        <nav>
          <ul class="nav-list">
            ${renderNavButton("dashboard", "Dashboard")}
            ${renderNavButton("posts", "Posts")}
            ${renderNavButton("runs", "Run Results")}
            ${renderNavButton("settings", "Settings")}
          </ul>
        </nav>
      </aside>
      <main class="main-area">
        <div class="mobile-tabs">
          ${renderNavButton("dashboard", "Dashboard")}
          ${renderNavButton("posts", "Posts")}
          ${renderNavButton("runs", "Run Results")}
          ${renderNavButton("settings", "Settings")}
        </div>
        <header class="topbar">
          <div class="cluster">
            <h1 style="margin:0;font-family:Sora,sans-serif;font-size:1.6rem;">${titleMap[route] || "Dashboard"}</h1>
            <input class="input search" placeholder="Search posts or runs..." value="${escapeHtml(state.search)}" data-input="global-search" />
          </div>
          <div class="cluster">
            ${
              runsRoute
                ? `<span class="badge ${state.polling.enabled ? "running" : "skipped"}">${escapeHtml(
                    pollingStatusText()
                  )}</span>`
                : ""
            }
            ${
              runsRoute
                ? `<button class="btn btn-secondary" data-action="toggle-runs-polling">${
                    state.polling.enabled ? "Pause Live" : "Resume Live"
                  }</button>`
                : ""
            }
            <button class="btn btn-secondary" data-action="refresh-data" ${state.loading ? "disabled" : ""}>Refresh</button>
            <button class="btn btn-primary" data-action="open-quick-publish">Trigger Publish</button>
            <button class="btn btn-ghost" data-action="logout">Sign out</button>
          </div>
        </header>
        ${renderRouteContent()}
      </main>
    </div>
  `;
}

function renderNavButton(page, label) {
  const current = state.route.page === page || (page === "runs" && state.route.page === "runDetail") || (page === "posts" && state.route.page === "postEditor");
  return `
    <li>
      <button class="nav-btn ${current ? "is-active" : ""}" data-action="nav" data-page="${page}">
        <span class="label">${label}</span>
      </button>
    </li>
  `;
}

function renderRouteContent() {
  if (state.loading && !state.data.loadedAt) {
    return `
      <div class="card">
        <div class="loading-shimmer"></div>
        <div class="loading-shimmer" style="margin-top:8px"></div>
        <div class="loading-shimmer" style="margin-top:8px"></div>
      </div>
    `;
  }

  switch (state.route.page) {
    case "dashboard":
      return renderDashboardView();
    case "posts":
      return renderPostsView();
    case "postEditor":
      return renderPostEditorView();
    case "runs":
      return renderRunsView();
    case "runDetail":
      return renderRunDetailView();
    case "settings":
      return renderSettingsView();
    default:
      return renderDashboardView();
  }
}

function renderDashboardView() {
  const stats = computeDashboardStats();
  const recentRuns = state.data.jobs.slice(0, 10);
  const failures = state.data.published.filter((p) => !p.isSuccess).slice(0, 8);

  return `
    <section class="grid kpi">
      ${renderKpiCard("Active Posts", stats.activePosts)}
      ${renderKpiCard("Eligible Now", stats.eligibleNow)}
      ${renderKpiCard("Runs Today", stats.runsToday)}
      ${renderKpiCard("Failure Rate (24h)", `${stats.failureRate24h}%`)}
    </section>
    <section class="split">
      <article class="card">
        <h3>Recent Runs</h3>
        ${
          recentRuns.length === 0
            ? `<div class="empty-state">No run records found.</div>`
            : `<ul class="timeline-list">${recentRuns.map(renderRunTimelineItem).join("")}</ul>`
        }
      </article>
      <article class="card">
        <h3>Quick Publish</h3>
        <p class="muted">Trigger a manual run for X, Threads, or both.</p>
        <div class="btn-row">
          <button class="btn btn-primary" data-action="open-quick-publish">Open Publish Modal</button>
        </div>
        <div class="hr"></div>
        <h4 style="margin-top:0">Recent Failures</h4>
        ${
          failures.length === 0
            ? `<p class="muted">No recent failed attempts.</p>`
            : `<div class="panel-list">${failures.map(renderFailureItem).join("")}</div>`
        }
      </article>
    </section>
  `;
}

function renderKpiCard(label, value) {
  return `
    <article class="card">
      <div class="muted">${escapeHtml(label)}</div>
      <div class="kpi-value">${escapeHtml(String(value))}</div>
    </article>
  `;
}

function renderRunTimelineItem(run) {
  const badge = renderResultBadge(run.result);
  return `
    <li class="timeline-item">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
        <strong class="mono">${escapeHtml(run.runKey)}</strong>
        ${badge}
      </div>
      <div class="muted">${escapeHtml(formatDate(run.startTime))} • ${escapeHtml(run.source)}</div>
      <div class="btn-row">
        <button class="btn btn-ghost" data-action="open-run" data-run-key="${escapeHtmlAttr(run.runKey)}">View</button>
      </div>
    </li>
  `;
}

function renderFailureItem(item) {
  const run = state.data.jobs.find((j) => j.recordId === item.jobRecordId);
  return `
    <div class="panel-item">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
        <span class="badge failed">Failed</span>
        <span class="muted">${escapeHtml(formatDate(item.finishedAt || run?.endTime || run?.startTime))}</span>
      </div>
      <div style="margin-top:6px;"><strong>${escapeHtml(item.platformLabel)}</strong> • ${escapeHtml(item.errorMessage || "Unknown error")}</div>
      ${
        run
          ? `<button class="btn btn-ghost" style="margin-top:8px;" data-action="open-run" data-run-key="${escapeHtmlAttr(run.runKey)}">Open Run</button>`
          : ""
      }
    </div>
  `;
}

function renderPostsView() {
  const records = getFilteredPosts();
  const formats = Array.from(new Set(state.data.posts.map((p) => p.format).filter(Boolean)));

  return `
    <section class="card">
      <div class="topbar" style="margin-bottom:12px;">
        <div class="cluster">
          <select class="select" data-input="filter-status">
            ${renderOption("all", "All statuses", state.postsFilter.status)}
            ${renderOption("Active", "Active", state.postsFilter.status)}
            ${renderOption("Inactive", "Inactive", state.postsFilter.status)}
          </select>
          <select class="select" data-input="filter-platform">
            ${renderOption("all", "All platforms", state.postsFilter.platform)}
            ${renderOption("x", "X", state.postsFilter.platform)}
            ${renderOption("threads", "Threads", state.postsFilter.platform)}
          </select>
          <select class="select" data-input="filter-format">
            ${renderOption("all", "All formats", state.postsFilter.format)}
            ${formats.map((format) => renderOption(format, format, state.postsFilter.format)).join("")}
          </select>
        </div>
        <div class="cluster">
          <button class="btn btn-secondary" data-action="new-post">New Post</button>
        </div>
      </div>
      ${
        records.length === 0
          ? `<div class="empty-state">No posts match the current filters.</div>`
          : `
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Id</th>
                    <th>Status</th>
                    <th>Platforms</th>
                    <th>Format</th>
                    <th>Weight</th>
                    <th>Last X</th>
                    <th>Last Threads</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${records.map(renderPostRow).join("")}
                </tbody>
              </table>
            </div>
          `
      }
    </section>
  `;
}

function renderPostRow(post) {
  return `
    <tr>
      <td class="mono">${escapeHtml(String(post.id || post.recordId))}</td>
      <td>${post.status === "Active" ? `<span class="badge success">Active</span>` : `<span class="badge skipped">Inactive</span>`}</td>
      <td>${renderPlatforms(post.platforms)}</td>
      <td>${escapeHtml(post.format || "-")}</td>
      <td class="mono">${escapeHtml(String(post.weight ?? 1))}</td>
      <td class="mono">${escapeHtml(formatDate(post.lastPostedOnXTime))}</td>
      <td class="mono">${escapeHtml(formatDate(post.lastPostedOnThreadsTime))}</td>
      <td>
        <div class="btn-row">
          <button class="btn btn-ghost" data-action="edit-post" data-record-id="${escapeHtmlAttr(post.recordId)}">Edit</button>
          <button class="btn btn-ghost" data-action="trigger-post" data-record-id="${escapeHtmlAttr(post.recordId)}">Trigger</button>
          <button class="btn btn-danger" data-action="delete-post" data-record-id="${escapeHtmlAttr(post.recordId)}">Delete</button>
        </div>
      </td>
    </tr>
  `;
}

function renderPlatforms(platforms) {
  if (!platforms.length) return "<span class='muted'>-</span>";
  return `<div class="inline-chips">${platforms.map((p) => `<span class="chip">${escapeHtml(platformLabel(p))}</span>`).join("")}</div>`;
}

function renderPostEditorView() {
  const editing = state.route.mode === "edit";
  const post = editing ? state.data.posts.find((p) => p.recordId === state.route.recordId) : null;
  if (editing && !post) {
    return `<section class="card"><div class="empty-state">Post not found.</div></section>`;
  }

  const model = post || {
    recordId: "",
    id: "",
    status: "Active",
    platforms: ["x", "threads"],
    format: "",
    text: "",
    weight: 1,
  };

  const split = buildPartsPreview(model.text || "");

  return `
    <section class="split">
      <article class="card">
        <h3>${editing ? "Edit Post" : "New Post"}</h3>
        <form id="post-form" data-mode="${editing ? "edit" : "new"}" data-record-id="${escapeHtmlAttr(model.recordId || "")}">
          <div class="split">
            <div class="field">
              <label>Status</label>
              <select name="status" class="select">
                ${renderOption("Active", "Active", model.status)}
                ${renderOption("Inactive", "Inactive", model.status)}
              </select>
            </div>
            <div class="field">
              <label>Weight</label>
              <input class="input" type="number" min="1" name="weight" value="${escapeHtml(String(model.weight || 1))}" />
            </div>
          </div>
          <div class="field">
            <label>Platforms</label>
            <div class="btn-row">
              <label class="chip-toggle ${model.platforms.includes("x") ? "is-on" : ""}"><input type="checkbox" name="platformX" ${model.platforms.includes("x") ? "checked" : ""} /> X</label>
              <label class="chip-toggle ${model.platforms.includes("threads") ? "is-on" : ""}"><input type="checkbox" name="platformThreads" ${model.platforms.includes("threads") ? "checked" : ""} /> Threads</label>
            </div>
          </div>
          <div class="field">
            <label>Format</label>
            <input class="input" name="format" value="${escapeHtml(model.format || "")}" />
          </div>
          <div class="field">
            <label>Text</label>
            <textarea class="textarea" name="text">${escapeHtml(model.text || "")}</textarea>
            <div class="help">Use <code>---PART---</code> to define explicit thread breaks.</div>
          </div>
          <div class="btn-row">
            <button class="btn btn-primary" type="submit" ${state.savingPost ? "disabled" : ""}>Save</button>
            ${
              editing
                ? `<button type="button" class="btn btn-secondary" data-action="trigger-post" data-record-id="${escapeHtmlAttr(model.recordId)}">Save and trigger</button>`
                : ""
            }
            <button type="button" class="btn btn-ghost" data-action="nav" data-page="posts">Cancel</button>
            ${
              editing
                ? `<button type="button" class="btn btn-danger" data-action="delete-post" data-record-id="${escapeHtmlAttr(model.recordId)}">Delete</button>`
                : ""
            }
          </div>
        </form>
      </article>
      <article class="card">
        <h3>Preview</h3>
        <p class="muted">Computed split previews using current platform limits.</p>
        <div class="panel-list">
          <div class="panel-item">
            <h4>Threads (${split.threads.length})</h4>
            ${split.threads.length === 0 ? `<p class="muted">No parts</p>` : split.threads.map((p, idx) => `<p class="mono">${idx + 1}. ${escapeHtml(p)}</p>`).join("")}
          </div>
          <div class="panel-item">
            <h4>X (${split.x.length})</h4>
            ${split.x.length === 0 ? `<p class="muted">No parts</p>` : split.x.map((p, idx) => `<p class="mono">${idx + 1}. ${escapeHtml(p)}</p>`).join("")}
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderRunsView() {
  const runs = getFilteredRuns();
  return `
    <section class="card">
      ${
        runs.length === 0
          ? `<div class="empty-state">No runs found.</div>`
          : `
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Run Key</th>
                    <th>Source</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Result</th>
                    <th>Post</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${runs.map(renderRunRow).join("")}
                </tbody>
              </table>
            </div>
          `
      }
    </section>
  `;
}

function renderRunRow(run) {
  return `
    <tr>
      <td class="mono">${escapeHtml(run.runKey)}</td>
      <td><span class="badge light">${escapeHtml(run.source)}</span></td>
      <td class="mono">${escapeHtml(formatDate(run.startTime))}</td>
      <td class="mono">${escapeHtml(formatDate(run.endTime))}</td>
      <td>${renderResultBadge(run.result)}</td>
      <td class="mono">${escapeHtml(String(run.postId || run.postRecordId || "-"))}</td>
      <td>
        <div class="btn-row">
          <button class="btn btn-ghost" data-action="open-run" data-run-key="${escapeHtmlAttr(run.runKey)}">View</button>
          <button class="btn btn-ghost" data-action="retry-run" data-run-key="${escapeHtmlAttr(run.runKey)}">Retry</button>
        </div>
      </td>
    </tr>
  `;
}

function renderRunDetailView() {
  const run = state.data.jobs.find((job) => job.runKey === state.route.runKey);
  if (!run) return `<section class="card"><div class="empty-state">Run ${escapeHtml(state.route.runKey)} not found.</div></section>`;

  const attempts = state.data.published.filter((p) => p.jobRecordId === run.recordId);
  const xAttempt = attempts.find((a) => a.platform === "x");
  const threadsAttempt = attempts.find((a) => a.platform === "threads");

  return `
    <section class="grid">
      <article class="card">
        <h3>Run Summary</h3>
        <div class="kv">
          <div><div class="muted">Run Key</div><div class="mono">${escapeHtml(run.runKey)}</div></div>
          <div><div class="muted">Result</div><div>${renderResultBadge(run.result)}</div></div>
          <div><div class="muted">Source</div><div>${escapeHtml(run.source)}</div></div>
          <div><div class="muted">Post Id</div><div class="mono">${escapeHtml(String(run.postId || run.postRecordId || "-"))}</div></div>
          <div><div class="muted">Start</div><div class="mono">${escapeHtml(formatDate(run.startTime))}</div></div>
          <div><div class="muted">End</div><div class="mono">${escapeHtml(formatDate(run.endTime))}</div></div>
        </div>
      </article>
      <section class="split">
        ${renderPlatformAttemptCard("X", xAttempt)}
        ${renderPlatformAttemptCard("Threads", threadsAttempt)}
      </section>
    </section>
  `;
}

function renderPlatformAttemptCard(label, attempt) {
  if (!attempt) {
    return `
      <article class="card">
        <h3>${escapeHtml(label)}</h3>
        <p class="muted">Not attempted for this run.</p>
      </article>
    `;
  }

  return `
    <article class="card">
      <h3>${escapeHtml(label)}</h3>
      <p>${attempt.isSuccess ? `<span class="badge success">Success</span>` : `<span class="badge failed">Failed</span>`}</p>
      <p class="mono">Post ID: ${escapeHtml(attempt.platformPostId || "-")}</p>
      ${
        attempt.platformPostLink
          ? `<p><a href="${escapeHtmlAttr(attempt.platformPostLink)}" target="_blank" rel="noreferrer">Open published post</a></p>`
          : ""
      }
      ${
        attempt.errorMessage
          ? `<div class="panel-item"><strong>Error</strong><p class="mono">${escapeHtml(attempt.errorMessage)}</p></div>`
          : ""
      }
    </article>
  `;
}

function renderSettingsView() {
  const s = state.session;
  return `
    <section class="card">
      <h3>Session and Connectors</h3>
      <p class="help">Update connector settings in-session. Save to apply immediately.</p>
      <form id="settings-form">
        <div class="split">
          <div class="field">
            <label>Email</label>
            <input class="input" name="email" value="${escapeHtml(s.identity.email)}" />
          </div>
          <div class="field">
            <label>Timezone</label>
            <input class="input" name="timezone" value="${escapeHtml(s.settings.timezone)}" />
          </div>
        </div>
        <div class="split">
          <div class="field">
            <label>Airtable token</label>
            <input class="input mono" name="airtableToken" type="password" value="${escapeHtml(s.airtable.token)}" />
          </div>
          <div class="field">
            <label>Airtable base ID</label>
            <input class="input mono" name="airtableBaseId" value="${escapeHtml(s.airtable.baseId)}" />
          </div>
        </div>
        <div class="split">
          <div class="field">
            <label>Posts table</label>
            <input class="input" name="postsTable" value="${escapeHtml(s.airtable.postsTable)}" />
          </div>
          <div class="field">
            <label>Jobs table</label>
            <input class="input" name="jobsTable" value="${escapeHtml(s.airtable.jobsTable)}" />
          </div>
        </div>
        <div class="split">
          <div class="field">
            <label>Published table</label>
            <input class="input" name="publishedTable" value="${escapeHtml(s.airtable.publishedTable)}" />
          </div>
          <div class="field">
            <label>Threads username</label>
            <input class="input" name="threadsUsername" value="${escapeHtml(s.airtable.threadsUsername || "")}" />
          </div>
        </div>
        <div class="hr"></div>
        <div class="split">
          <div class="field">
            <label>GitHub token</label>
            <input class="input mono" name="githubToken" type="password" value="${escapeHtml(s.github.token)}" />
          </div>
          <div class="field">
            <label>Workflow file/ID</label>
            <input class="input" name="workflow" value="${escapeHtml(s.github.workflow)}" />
          </div>
        </div>
        <div class="split">
          <div class="field">
            <label>Repo owner</label>
            <input class="input" name="githubOwner" value="${escapeHtml(s.github.owner)}" />
          </div>
          <div class="field">
            <label>Repo name</label>
            <input class="input" name="githubRepo" value="${escapeHtml(s.github.repo)}" />
          </div>
        </div>
        <div class="split">
          <div class="field">
            <label>Workflow ref</label>
            <input class="input" name="workflowRef" value="${escapeHtml(s.github.ref)}" />
          </div>
          <div class="field">
            <label>Default lookback days</label>
            <input class="input" type="number" min="1" name="lookbackDays" value="${escapeHtml(String(s.settings.lookbackDays))}" />
          </div>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" type="submit">Save Settings</button>
          <button class="btn btn-secondary" type="button" data-action="refresh-data">Refresh Data</button>
        </div>
      </form>
    </section>
  `;
}

function renderResultBadge(resultRaw) {
  const result = String(resultRaw || "").toLowerCase();
  if (result === "success") return `<span class="badge success">Success</span>`;
  if (result === "partial") return `<span class="badge partial">Partial</span>`;
  if (result === "failed") return `<span class="badge failed">Failed</span>`;
  if (result === "running") return `<span class="badge running">Running</span>`;
  return `<span class="badge skipped">Skipped</span>`;
}

function renderOption(value, label, selectedValue) {
  return `<option value="${escapeHtmlAttr(String(value))}" ${String(selectedValue) === String(value) ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function renderOverlays() {
  const parts = [];
  if (state.modal) parts.push(renderModal(state.modal));
  parts.push(renderToasts());

  const existing = document.querySelector("#overlay-root");
  if (existing) existing.remove();

  const root = document.createElement("div");
  root.id = "overlay-root";
  root.innerHTML = parts.join("");
  document.body.appendChild(root);
}

function renderModal(modal) {
  if (modal.type === "delete-post") {
    return `
      <div class="modal-layer" role="dialog" aria-modal="true">
        <div class="card modal">
          <h3>Delete post</h3>
          <p>Delete post <code>${escapeHtml(modal.postIdDisplay)}</code>? This cannot be undone.</p>
          <div class="btn-row">
            <button class="btn btn-danger" data-action="confirm-delete-post" data-record-id="${escapeHtmlAttr(modal.recordId)}">Delete</button>
            <button class="btn btn-secondary" data-action="close-modal">Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

  if (modal.type === "quick-publish") {
    const defaults = modal.payload || {};
    const posts = state.data.posts;
    return `
      <div class="modal-layer" role="dialog" aria-modal="true">
        <div class="card modal">
          <h3>Trigger publish</h3>
          <form id="quick-publish-form">
            <div class="field">
              <label>Post</label>
              <select class="select" name="postRecordId" required>
                <option value="">Select a post...</option>
                ${posts.map((p) => `<option value="${escapeHtmlAttr(p.recordId)}" ${defaults.postRecordId === p.recordId ? "selected" : ""}>${escapeHtml(String(p.id || p.recordId))} • ${escapeHtml((p.text || "").slice(0, 72))}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label>Target platforms</label>
              <div class="btn-row">
                <label class="chip-toggle ${defaults.targets === "x" ? "is-on" : ""}"><input type="radio" name="targets" value="x" ${defaults.targets === "x" ? "checked" : ""} /> X</label>
                <label class="chip-toggle ${defaults.targets === "threads" ? "is-on" : ""}"><input type="radio" name="targets" value="threads" ${defaults.targets === "threads" ? "checked" : ""} /> Threads</label>
                <label class="chip-toggle ${!defaults.targets || defaults.targets === "both" ? "is-on" : ""}"><input type="radio" name="targets" value="both" ${!defaults.targets || defaults.targets === "both" ? "checked" : ""} /> Both</label>
              </div>
            </div>
            <div class="field">
              <label>Lookback days override (optional)</label>
              <input class="input" type="number" min="1" name="lookbackDays" value="${escapeHtml(String(defaults.lookbackDays || state.session.settings.lookbackDays || DEFAULTS.lookbackDays))}" />
            </div>
            <div class="btn-row">
              <button class="btn btn-primary" type="submit" ${state.posting ? "disabled" : ""}>${state.posting ? "Triggering..." : "Trigger Publish"}</button>
              <button class="btn btn-secondary" type="button" data-action="close-modal">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  return "";
}

function renderToasts() {
  if (state.toasts.length === 0) return "";
  return `
    <div class="toast-area" aria-live="polite">
      ${state.toasts.map((t) => `<div class="toast ${escapeHtmlAttr(t.type)}">${escapeHtml(t.message)}</div>`).join("")}
    </div>
  `;
}

function handleGlobalClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;

  const action = target.getAttribute("data-action");

  if (action === "back-login") {
    state.pendingAuth = null;
    navigate("/login");
    return;
  }
  if (action === "close-modal") {
    state.modal = null;
    renderOverlays();
    return;
  }
  if (action === "nav") {
    const page = target.getAttribute("data-page");
    if (page === "dashboard") navigate("/dashboard");
    if (page === "posts") navigate("/posts");
    if (page === "runs") navigate("/runs");
    if (page === "settings") navigate("/settings");
    return;
  }
  if (action === "logout") {
    clearSession();
    navigate("/login");
    pushToast("Signed out.", "info");
    return;
  }
  if (action === "refresh-data") {
    refreshData({ silent: false }).catch((err) => pushToast(cleanError(err), "error"));
    return;
  }
  if (action === "toggle-runs-polling") {
    if (state.polling.enabled) {
      stopRunsPolling({ notify: true });
      render();
    } else {
      startRunsPolling({ durationMs: RUNS_POLL_MAX_DURATION_MS, immediate: true });
      pushToast("Live run updates resumed.", "success");
    }
    return;
  }
  if (action === "open-quick-publish") {
    state.modal = { type: "quick-publish", payload: {} };
    renderOverlays();
    return;
  }
  if (action === "new-post") {
    navigate("/posts/new");
    return;
  }
  if (action === "edit-post") {
    const recordId = target.getAttribute("data-record-id");
    navigate(`/posts/${encodeURIComponent(recordId)}/edit`);
    return;
  }
  if (action === "trigger-post") {
    const recordId = target.getAttribute("data-record-id");
    state.modal = { type: "quick-publish", payload: { postRecordId: recordId, targets: "both" } };
    renderOverlays();
    return;
  }
  if (action === "delete-post") {
    const recordId = target.getAttribute("data-record-id");
    const post = state.data.posts.find((p) => p.recordId === recordId);
    state.modal = {
      type: "delete-post",
      recordId,
      postIdDisplay: post?.id || recordId,
    };
    renderOverlays();
    return;
  }
  if (action === "confirm-delete-post") {
    const recordId = target.getAttribute("data-record-id");
    deletePost(recordId).catch((err) => pushToast(cleanError(err), "error"));
    return;
  }
  if (action === "open-run") {
    const runKey = target.getAttribute("data-run-key");
    navigate(`/runs/${encodeURIComponent(runKey)}`);
    return;
  }
  if (action === "retry-run") {
    const runKey = target.getAttribute("data-run-key");
    const run = state.data.jobs.find((job) => job.runKey === runKey);
    state.modal = {
      type: "quick-publish",
      payload: { postRecordId: run?.postRecordId || "", targets: "both" },
    };
    renderOverlays();
  }
}

function handleGlobalInput(event) {
  const target = event.target;
  const inputType = target.getAttribute("data-input");
  if (!inputType) return;

  if (inputType === "global-search") {
    state.search = target.value;
    render();
    return;
  }
  if (inputType === "filter-status") {
    state.postsFilter.status = target.value;
    render();
    return;
  }
  if (inputType === "filter-platform") {
    state.postsFilter.platform = target.value;
    render();
    return;
  }
  if (inputType === "filter-format") {
    state.postsFilter.format = target.value;
    render();
  }
}

async function handleGlobalSubmit(event) {
  if (!(event.target instanceof HTMLFormElement)) return;

  if (event.target.id === "login-form") {
    event.preventDefault();
    await submitLogin(event.target);
    return;
  }
  if (event.target.id === "verify-form") {
    event.preventDefault();
    await submitVerify(event.target);
    return;
  }
  if (event.target.id === "post-form") {
    event.preventDefault();
    await submitPostForm(event.target);
    return;
  }
  if (event.target.id === "quick-publish-form") {
    event.preventDefault();
    await submitQuickPublish(event.target);
    return;
  }
  if (event.target.id === "settings-form") {
    event.preventDefault();
    await submitSettings(event.target);
  }
}

async function submitLogin(form) {
  const fd = new FormData(form);
  const email = String(fd.get("email") || "").trim();
  const password = String(fd.get("password") || "").trim();
  const totpSecret = String(fd.get("totpSecret") || "").trim();

  if (!email || !password) {
    pushToast("Email and password are required.", "warning");
    return;
  }

  const payload = {
    identity: { userId: email.toLowerCase(), email, role: "admin" },
    auth: {
      twoFactorEnabled: !!totpSecret,
      twoFactorVerified: !totpSecret,
      sessionExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    },
    secrets: { password, totpSecret },
    airtable: {
      token: String(fd.get("airtableToken") || "").trim(),
      baseId: String(fd.get("airtableBaseId") || "").trim(),
      postsTable: String(fd.get("postsTable") || "").trim() || DEFAULTS.postsTable,
      jobsTable: String(fd.get("jobsTable") || "").trim() || DEFAULTS.jobsTable,
      publishedTable: String(fd.get("publishedTable") || "").trim() || DEFAULTS.publishedTable,
      threadsUsername: String(fd.get("threadsUsername") || "").trim(),
    },
    github: {
      token: String(fd.get("githubToken") || "").trim(),
      owner: String(fd.get("githubOwner") || "").trim(),
      repo: String(fd.get("githubRepo") || "").trim(),
      workflow: String(fd.get("workflow") || "").trim() || DEFAULTS.workflow,
      ref: String(fd.get("workflowRef") || "").trim() || DEFAULTS.ref,
    },
    settings: {
      lookbackDays: Number(fd.get("lookbackDays") || DEFAULTS.lookbackDays),
      timezone: String(fd.get("timezone") || "").trim() || DEFAULTS.timezone,
    },
  };

  if (!payload.airtable.token || !payload.airtable.baseId || !payload.github.token || !payload.github.owner || !payload.github.repo) {
    pushToast("Airtable and GitHub connector fields are required.", "warning");
    return;
  }

  const rememberProfile = fd.get("rememberProfile") === "on";
  const rememberSecrets = fd.get("rememberSecrets") === "on";
  const profileToSave = {
    email,
    totpSecret: rememberSecrets ? totpSecret : "",
    postsTable: payload.airtable.postsTable,
    jobsTable: payload.airtable.jobsTable,
    publishedTable: payload.airtable.publishedTable,
    threadsUsername: payload.airtable.threadsUsername,
    githubOwner: payload.github.owner,
    githubRepo: payload.github.repo,
    workflow: payload.github.workflow,
    workflowRef: payload.github.ref,
    lookbackDays: payload.settings.lookbackDays,
    timezone: payload.settings.timezone,
    rememberProfile,
    rememberSecrets,
    airtableToken: rememberSecrets ? payload.airtable.token : "",
    airtableBaseId: rememberSecrets ? payload.airtable.baseId : "",
    githubToken: rememberSecrets ? payload.github.token : "",
  };
  if (rememberProfile) {
    saveProfile(profileToSave);
  } else {
    localStorage.removeItem(STORAGE_KEYS.PROFILE);
  }

  if (totpSecret) {
    state.pendingAuth = payload;
    navigate("/login/verify");
    pushToast("Enter your 2FA code to continue.", "info");
    return;
  }

  state.session = {
    identity: payload.identity,
    auth: payload.auth,
    airtable: payload.airtable,
    github: payload.github,
    settings: payload.settings,
  };
  saveSession(state.session);
  state.pendingAuth = null;

  await refreshData({ silent: false });
  navigate("/dashboard");
  pushToast("Signed in successfully.", "success");
}

async function submitVerify(form) {
  const pending = state.pendingAuth;
  if (!pending) {
    navigate("/login");
    return;
  }
  const fd = new FormData(form);
  const code = String(fd.get("otpCode") || "").trim();
  const secret = pending.secrets?.totpSecret || "";
  const valid = await verifyTotpCode(secret, code);
  if (!valid) {
    pushToast("Invalid or expired 2FA code.", "error");
    return;
  }

  state.session = {
    identity: pending.identity,
    auth: {
      ...pending.auth,
      twoFactorVerified: true,
    },
    airtable: pending.airtable,
    github: pending.github,
    settings: pending.settings,
  };
  saveSession(state.session);
  state.pendingAuth = null;
  await refreshData({ silent: false });
  navigate("/dashboard");
  pushToast("2FA verified. Signed in.", "success");
}

async function submitSettings(form) {
  const fd = new FormData(form);
  state.session = {
    ...state.session,
    identity: {
      ...state.session.identity,
      email: String(fd.get("email") || state.session.identity.email).trim(),
      userId: String(fd.get("email") || state.session.identity.email).trim().toLowerCase(),
    },
    airtable: {
      token: String(fd.get("airtableToken") || "").trim(),
      baseId: String(fd.get("airtableBaseId") || "").trim(),
      postsTable: String(fd.get("postsTable") || DEFAULTS.postsTable).trim(),
      jobsTable: String(fd.get("jobsTable") || DEFAULTS.jobsTable).trim(),
      publishedTable: String(fd.get("publishedTable") || DEFAULTS.publishedTable).trim(),
      threadsUsername: String(fd.get("threadsUsername") || "").trim(),
    },
    github: {
      token: String(fd.get("githubToken") || "").trim(),
      owner: String(fd.get("githubOwner") || "").trim(),
      repo: String(fd.get("githubRepo") || "").trim(),
      workflow: String(fd.get("workflow") || DEFAULTS.workflow).trim(),
      ref: String(fd.get("workflowRef") || DEFAULTS.ref).trim(),
    },
    settings: {
      lookbackDays: Number(fd.get("lookbackDays") || DEFAULTS.lookbackDays),
      timezone: String(fd.get("timezone") || DEFAULTS.timezone).trim(),
    },
  };
  saveSession(state.session);
  pushToast("Settings saved.", "success");
  await refreshData({ silent: true });
  render();
}

async function submitPostForm(form) {
  state.savingPost = true;
  render();
  try {
    const fd = new FormData(form);
    const mode = form.getAttribute("data-mode");
    const recordId = form.getAttribute("data-record-id");
    const status = String(fd.get("status") || "Active");
    const weight = Number(fd.get("weight") || 1);
    const text = String(fd.get("text") || "").trim();
    const format = String(fd.get("format") || "").trim();
    const platforms = [];
    if (fd.get("platformX")) platforms.push("X");
    if (fd.get("platformThreads")) platforms.push("Threads");

    if (!text) throw new Error("Post text is required.");
    if (!Number.isFinite(weight) || weight < 1) throw new Error("Weight must be at least 1.");
    if (platforms.length === 0) throw new Error("Select at least one platform.");

    const fields = {
      Status: status,
      Platforms: platforms,
      Format: format,
      Text: text,
      Weight: weight,
    };

    if (mode === "edit") {
      await airtableUpdateRecord(state.session.airtable, state.session.airtable.postsTable, recordId, fields);
      pushToast("Post updated.", "success");
    } else {
      await airtableCreateRecord(state.session.airtable, state.session.airtable.postsTable, fields);
      pushToast("Post created.", "success");
    }
    await refreshData({ silent: true });
    navigate("/posts");
  } catch (err) {
    pushToast(cleanError(err), "error");
  } finally {
    state.savingPost = false;
    render();
  }
}

async function deletePost(recordId) {
  try {
    await airtableDeleteRecord(state.session.airtable, state.session.airtable.postsTable, recordId);
    state.modal = null;
    pushToast("Post deleted.", "success");
    await refreshData({ silent: true });
    if (state.route.page === "postEditor") navigate("/posts");
    render();
  } catch (err) {
    pushToast(cleanError(err), "error");
  }
}

async function submitQuickPublish(form) {
  const fd = new FormData(form);
  const postRecordId = String(fd.get("postRecordId") || "").trim();
  const targets = String(fd.get("targets") || "both");
  const lookbackDays = String(fd.get("lookbackDays") || state.session.settings.lookbackDays || DEFAULTS.lookbackDays).trim();

  if (!postRecordId) {
    pushToast("Select a post to publish.", "warning");
    return;
  }

  const targetPlatforms = targets === "both" ? "threads,x" : targets;
  state.posting = true;
  renderOverlays();
  try {
    await dispatchWorkflow(state.session.github, {
      postId: postRecordId,
      lookbackDays,
      targetPlatforms,
    });
    state.modal = null;
    pushToast("Manual publish triggered. Opening Runs with live updates...", "success");
    await delay(700);
    await refreshData({ silent: true });
    navigate("/runs");
    startRunsPolling({ durationMs: RUNS_POLL_MAX_DURATION_MS, immediate: true });
  } catch (err) {
    pushToast(cleanError(err), "error", 8000);
  } finally {
    state.posting = false;
    render();
  }
}

async function refreshData({ silent = true } = {}) {
  if (!state.session) return;
  state.loading = true;
  if (!silent) render();

  try {
    const airtable = state.session.airtable;
    const [postRecords, jobRecords, publishedRecords] = await Promise.all([
      airtableListRecords(airtable, airtable.postsTable, { sortField: "Id", direction: "desc" }),
      airtableListRecords(airtable, airtable.jobsTable, { sortField: "StartTime", direction: "desc", maxRecords: 200 }),
      airtableListRecords(airtable, airtable.publishedTable, { maxRecords: 500 }),
    ]);

    state.data.posts = postRecords.map(mapPostRecord).sort((a, b) => (b.id || 0) - (a.id || 0));
    state.data.jobs = jobRecords.map(mapJobRecord).sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0));
    state.data.published = publishedRecords.map((r) => mapPublishedRecord(r, state.session.airtable.threadsUsername));
    state.data.loadedAt = new Date().toISOString();
  } finally {
    state.loading = false;
    render();
  }
}

function getFilteredPosts() {
  const query = state.search.trim().toLowerCase();
  return state.data.posts.filter((p) => {
    if (state.postsFilter.status !== "all" && p.status !== state.postsFilter.status) return false;
    if (state.postsFilter.platform !== "all" && !p.platforms.includes(state.postsFilter.platform)) return false;
    if (state.postsFilter.format !== "all" && p.format !== state.postsFilter.format) return false;
    if (!query) return true;
    return [String(p.id || ""), p.recordId, p.format || "", p.text || ""].join(" ").toLowerCase().includes(query);
  });
}

function getFilteredRuns() {
  const query = state.search.trim().toLowerCase();
  return state.data.jobs.filter((r) => {
    if (!query) return true;
    return [r.runKey, r.source, r.result, String(r.postId || ""), r.postRecordId || ""].join(" ").toLowerCase().includes(query);
  });
}

function computeDashboardStats() {
  const activePosts = state.data.posts.filter((p) => p.status === "Active");
  const lookbackDays = Number(state.session?.settings?.lookbackDays || DEFAULTS.lookbackDays);
  const cutoff = Date.now() - lookbackDays * 86400_000;
  const eligibleNow = activePosts.filter((p) => {
    if (!p.platforms.includes("x") || !p.platforms.includes("threads")) return false;
    const xTime = p.lastPostedOnXTime ? new Date(p.lastPostedOnXTime).getTime() : 0;
    const thTime = p.lastPostedOnThreadsTime ? new Date(p.lastPostedOnThreadsTime).getTime() : 0;
    return (!xTime || xTime <= cutoff) && (!thTime || thTime <= cutoff);
  }).length;

  const timezone = state.session?.settings?.timezone || DEFAULTS.timezone;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const runsToday = state.data.jobs.filter((j) => sameLocalDay(j.startTime, today, timezone)).length;

  const windowStart = Date.now() - 24 * 3600_000;
  const recentAttempts = state.data.published.filter((a) => {
    const ts = a.finishedAt || a.startedAt;
    if (!ts) return false;
    return new Date(ts).getTime() >= windowStart;
  });
  const failedAttempts = recentAttempts.filter((a) => !a.isSuccess).length;
  const failureRate24h = recentAttempts.length ? Math.round((failedAttempts / recentAttempts.length) * 100) : 0;

  return {
    activePosts: activePosts.length,
    eligibleNow,
    runsToday,
    failureRate24h,
  };
}

function sameLocalDay(iso, todayYmd, timezone) {
  if (!iso) return false;
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
  return day === todayYmd;
}

async function dispatchWorkflow(cfg, payload) {
  const workflowPath = encodeURIComponent(cfg.workflow);
  const url = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/actions/workflows/${workflowPath}/dispatches`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: cfg.ref || DEFAULTS.ref,
      inputs: {
        lookback_days: String(payload.lookbackDays || DEFAULTS.lookbackDays),
        post_id: String(payload.postId),
        target_platforms: String(payload.targetPlatforms || "threads,x"),
      },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub workflow dispatch failed (${resp.status}): ${text || resp.statusText}`);
  }
}

async function airtableListRecords(cfg, tableName, { sortField, direction = "asc", filterByFormula, maxRecords } = {}) {
  const out = [];
  let offset = "";
  while (true) {
    const params = new URLSearchParams();
    params.set("pageSize", "100");
    if (offset) params.set("offset", offset);
    if (sortField) {
      params.set("sort[0][field]", sortField);
      params.set("sort[0][direction]", direction);
    }
    if (filterByFormula) params.set("filterByFormula", filterByFormula);
    if (maxRecords) params.set("maxRecords", String(maxRecords));

    const url = `https://api.airtable.com/v0/${encodeURIComponent(cfg.baseId)}/${encodeURIComponent(tableName)}?${params.toString()}`;
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Airtable read failed (${resp.status}): ${text || resp.statusText}`);
    }
    const data = await resp.json();
    const records = Array.isArray(data.records) ? data.records : [];
    out.push(...records);
    if (!data.offset) break;
    offset = data.offset;
    if (maxRecords && out.length >= maxRecords) break;
  }
  return maxRecords ? out.slice(0, maxRecords) : out;
}

async function airtableCreateRecord(cfg, tableName, fields) {
  const url = `https://api.airtable.com/v0/${encodeURIComponent(cfg.baseId)}/${encodeURIComponent(tableName)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Airtable create failed (${resp.status}): ${text || resp.statusText}`);
  }
  return resp.json();
}

async function airtableUpdateRecord(cfg, tableName, recordId, fields) {
  const url = `https://api.airtable.com/v0/${encodeURIComponent(cfg.baseId)}/${encodeURIComponent(tableName)}/${encodeURIComponent(recordId)}`;
  const resp = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Airtable update failed (${resp.status}): ${text || resp.statusText}`);
  }
  return resp.json();
}

async function airtableDeleteRecord(cfg, tableName, recordId) {
  const url = `https://api.airtable.com/v0/${encodeURIComponent(cfg.baseId)}/${encodeURIComponent(tableName)}/${encodeURIComponent(recordId)}`;
  const resp = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Airtable delete failed (${resp.status}): ${text || resp.statusText}`);
  }
}

function mapPostRecord(record) {
  const fields = record.fields || {};
  return {
    recordId: record.id,
    id: Number(fields.Id || 0) || 0,
    status: String(fields.Status || "Inactive"),
    platforms: normalizePlatforms(fields.Platforms),
    format: String(fields.Format || ""),
    text: String(fields.Text || ""),
    weight: Number(fields.Weight || 1) || 1,
    lastPostedOnXTime: fields.LastPostedOnXTime || "",
    lastPostedOnThreadsTime: fields.LastPostedOnThreadsTime || "",
    updatedAt: record.createdTime || "",
  };
}

function mapJobRecord(record) {
  const fields = record.fields || {};
  const runKey = String(fields.RunKey || "");
  return {
    recordId: record.id,
    runKey,
    source: runKey.includes(":direct:") ? "Manual" : "Scheduled",
    startTime: fields.StartTime || "",
    endTime: fields.EndTime || "",
    result: String(fields.Result || "Skipped"),
    postRecordId: Array.isArray(fields.Post) ? fields.Post[0] : "",
    postId: Array.isArray(fields.PostId) ? Number(fields.PostId[0] || 0) : Number(fields.PostId || 0),
  };
}

function mapPublishedRecord(record, threadsUsername = "") {
  const fields = record.fields || {};
  const platformRaw = String(fields.Platform || "").toLowerCase();
  const platform = platformRaw === "x" ? "x" : platformRaw === "threads" ? "threads" : "unknown";
  const platformPostId = String(fields.PlatformPostId || "");
  const platformPostLink = buildPlatformLink(platform, platformPostId, threadsUsername);

  return {
    recordId: record.id,
    jobRecordId: Array.isArray(fields.Job) ? fields.Job[0] : "",
    platform,
    platformLabel: platformLabel(platform),
    isSuccess: !!fields.IsSuccess,
    errorMessage: String(fields.ErrorMessage || ""),
    platformPostId,
    platformPostLink,
    startedAt: Array.isArray(fields.JobStartTime) ? fields.JobStartTime[0] : "",
    finishedAt: Array.isArray(fields.JobEndTime) ? fields.JobEndTime[0] : "",
  };
}

function platformLabel(platform) {
  if (platform === "x") return "X";
  if (platform === "threads") return "Threads";
  return platform;
}

function normalizePlatforms(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => String(v || "").toLowerCase().trim())
    .map((v) => (v === "thread" ? "threads" : v))
    .map((v) => (v === "x" ? "x" : v === "threads" ? "threads" : ""))
    .filter(Boolean);
}

function buildPlatformLink(platform, postId, threadsUsername = "") {
  if (!postId) return "";
  if (/^https?:\/\//i.test(postId)) return postId;
  if (platform === "x") return `https://x.com/i/web/status/${encodeURIComponent(postId)}`;
  if (platform === "threads") {
    const username = String(threadsUsername || "").trim().replace(/^@/, "");
    if (username && !/^\d+$/.test(postId)) {
      return `https://www.threads.com/@${encodeURIComponent(username)}/post/${encodeURIComponent(postId)}`;
    }
    return `https://www.threads.com/t/${encodeURIComponent(postId)}`;
  }
  return "";
}

function buildPartsPreview(text) {
  const baseParts = String(text || "")
    .split(/---PART---/gi)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    threads: flattenByLimit(baseParts, 500),
    x: flattenByLimit(baseParts, 280),
  };
}

function flattenByLimit(parts, limit) {
  const out = [];
  for (const part of parts) {
    out.push(...splitByLimit(part, limit));
  }
  return out;
}

function splitByLimit(text, limit) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const out = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (!current) {
      out.push(candidate.slice(0, limit));
      current = candidate.slice(limit);
      continue;
    }
    out.push(current);
    current = word;
  }
  if (current) out.push(current);
  return out;
}

function pushToast(message, type = "info", timeout = 5000) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  state.toasts.push({ id, message, type });
  renderOverlays();
  setTimeout(() => {
    state.toasts = state.toasts.filter((t) => t.id !== id);
    renderOverlays();
  }, timeout);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const tz = state.session?.settings?.timezone || DEFAULTS.timezone;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function cleanError(err) {
  const raw = String(err?.message || err || "Unknown error");
  try {
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw);
      if (parsed.error?.message) return parsed.error.message;
    }
  } catch {
    return raw;
  }
  return raw;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttr(str) {
  return escapeHtml(str).replace(/`/g, "&#96;");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyTotpCode(base32Secret, code) {
  const normalized = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const steps = [0, -1, 1];
  for (const offset of steps) {
    const expected = await generateTotp(base32Secret, offset);
    if (!expected) return false;
    if (expected === normalized) return true;
  }
  return false;
}

async function generateTotp(base32Secret, timeOffsetSteps = 0) {
  const keyBytes = base32ToBytes(base32Secret);
  if (keyBytes.length === 0) return "";

  const timestep = 30;
  const counter = Math.floor(Date.now() / 1000 / timestep) + timeOffsetSteps;
  const msg = new ArrayBuffer(8);
  const dv = new DataView(msg);
  const high = Math.floor(counter / 2 ** 32);
  const low = counter >>> 0;
  dv.setUint32(0, high);
  dv.setUint32(4, low);

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, msg);
  const bytes = new Uint8Array(sig);
  const offset = bytes[bytes.length - 1] & 0x0f;
  const binary =
    ((bytes[offset] & 0x7f) << 24) |
    ((bytes[offset + 1] & 0xff) << 16) |
    ((bytes[offset + 2] & 0xff) << 8) |
    (bytes[offset + 3] & 0xff);
  const otp = (binary % 1_000_000).toString().padStart(6, "0");
  return otp;
}

function base32ToBytes(base32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = String(base32 || "").toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of cleaned) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    out.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return new Uint8Array(out);
}
