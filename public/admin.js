/**
 * public/admin.js — HotelIQ Operations Panel
 *
 * Security contract:
 *   • Passwords are POSTed to /api/admin/auth over HTTPS and never stored
 *     locally (no localStorage, no sessionStorage, no cookies written here).
 *   • Session is maintained by an HttpOnly cookie set server-side — this
 *     script cannot read or modify it.
 *   • No INTERNAL_API_SECRET or provider keys ever appear in this file or
 *     in API responses consumed here.
 *   • All text from the API is set via textContent, never innerHTML.
 *
 * Architecture:
 *   The panel drives the pipeline one step at a time via POST /api/admin/run
 *   { action: "step" }. The server executes one enqueue page or one worker
 *   hotel per call, returning updated run state + provider usage. This keeps
 *   each server invocation within the Vercel 10s function timeout.
 */

(function () {
  "use strict";

  // ── State ──────────────────────────────────────────────────────
  const state = {
    isOpen: false,
    isAuthed: false,
    isRunning: false,
    currentRun: null,   // PipelineRun object from server
    startedAt: null,    // Date for elapsed timer
    timerInterval: null,
    stepPending: false, // prevents duplicate concurrent step calls
  };

  // ── DOM references (set after mount) ──────────────────────────
  let overlay, panel, authSection, opsSection;
  let authInput, authBtn, authError;
  let countInput, runBtn, stopRequested;
  let elPhase, elDot, elElapsed;
  let elEnqueued, elClaimed, elSucceeded, elFailed, elRequested;
  let elBanner, elUsageBody, elUsageNote;

  // ── Bootstrap ─────────────────────────────────────────────────
  function init() {
    injectSidebarButton();
    buildPanel();
    // Attempt a silent auth-check by fetching run status; if the cookie
    // is valid the server returns 200 and we can show the ops panel.
    checkSession();
  }

  // ── Sidebar entry point ───────────────────────────────────────
  function injectSidebarButton() {
    const footer = document.querySelector(".sidebar-footer");
    if (!footer) return;

    const btn = document.createElement("button");
    btn.className = "ops-sidebar-btn";
    btn.setAttribute("aria-label", "Open operations panel");
    btn.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>' +
      '<span class="collapse-label">Operations</span>';
    btn.addEventListener("click", openPanel);
    // Insert before the theme toggle
    const themeBtn = footer.querySelector(".theme-toggle-btn");
    if (themeBtn) {
      footer.insertBefore(btn, themeBtn);
    } else {
      footer.prepend(btn);
    }
  }

  // ── Panel DOM construction ────────────────────────────────────
  function buildPanel() {
    overlay = document.createElement("div");
    overlay.className = "ops-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Operations panel");

    // Click backdrop to close
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay && !state.isRunning) closePanel();
    });

    panel = document.createElement("div");
    panel.className = "ops-panel";
    panel.addEventListener("click", function (e) { e.stopPropagation(); });

    panel.appendChild(buildHeader());

    const body = document.createElement("div");
    body.className = "ops-body";

    authSection = buildAuthSection();
    opsSection = buildOpsSection();
    body.appendChild(authSection);
    body.appendChild(opsSection);

    panel.appendChild(body);
    panel.appendChild(buildFooter());

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // Keyboard: Escape closes panel
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.isOpen && !state.isRunning) closePanel();
    });
  }

  function buildHeader() {
    const h = document.createElement("div");
    h.className = "ops-header";

    const title = document.createElement("div");
    title.className = "ops-title";
    title.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>';
    const span = document.createElement("span");
    span.textContent = "Operations Panel";
    const badge = document.createElement("span");
    badge.className = "ops-title-badge";
    badge.textContent = "Admin";
    title.appendChild(span);
    title.appendChild(badge);

    const closeBtn = document.createElement("button");
    closeBtn.className = "ops-close-btn";
    closeBtn.setAttribute("aria-label", "Close operations panel");
    closeBtn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.addEventListener("click", function () {
      if (!state.isRunning) closePanel();
    });

    h.appendChild(title);
    h.appendChild(closeBtn);
    return h;
  }

  function buildAuthSection() {
    const sec = document.createElement("div");
    sec.className = "ops-auth-gate";

    sec.innerHTML =
      '<div class="ops-auth-icon">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
      "</div>" +
      '<p class="ops-auth-heading">Authorized Access</p>' +
      '<p class="ops-auth-sub">Enter the operations password to access the ingestion pipeline controls.</p>';

    const group = document.createElement("div");
    group.className = "ops-input-group";

    authInput = document.createElement("input");
    authInput.type = "password";
    authInput.className = "ops-input";
    authInput.placeholder = "Password";
    authInput.autocomplete = "current-password";
    authInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") submitAuth();
    });

    authBtn = document.createElement("button");
    authBtn.className = "ops-btn ops-btn-primary";
    authBtn.textContent = "Unlock";
    authBtn.addEventListener("click", submitAuth);

    group.appendChild(authInput);
    group.appendChild(authBtn);
    sec.appendChild(group);

    authError = document.createElement("div");
    authError.className = "ops-auth-error";
    authError.style.display = "none";
    sec.appendChild(authError);

    return sec;
  }

  function buildOpsSection() {
    const sec = document.createElement("div");
    sec.style.display = "none";

    // ── Run controls ────────────────────────────────────────────
    const controlsSec = document.createElement("div");
    controlsSec.className = "ops-section";

    const ctrlTitle = document.createElement("div");
    ctrlTitle.className = "ops-section-title";
    ctrlTitle.textContent = "Ingestion Controls";
    controlsSec.appendChild(ctrlTitle);

    const controls = document.createElement("div");
    controls.className = "ops-controls";

    const field = document.createElement("div");
    field.className = "ops-field";
    const label = document.createElement("label");
    label.className = "ops-label";
    label.textContent = "Hotels to enqueue";
    countInput = document.createElement("input");
    countInput.type = "number";
    countInput.className = "ops-count-input";
    countInput.min = "1";
    countInput.max = "500";
    countInput.value = "50";
    const hint = document.createElement("div");
    hint.className = "ops-hint";
    hint.textContent = "Max records fetched from client DB into queue";
    field.appendChild(label);
    field.appendChild(countInput);
    field.appendChild(hint);

    runBtn = document.createElement("button");
    runBtn.className = "ops-btn ops-btn-primary";
    runBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polygon points="5,3 19,12 5,21"/></svg>' +
      "<span>Run Pipeline</span>";
    runBtn.addEventListener("click", startRun);

    controls.appendChild(field);
    controls.appendChild(runBtn);
    controlsSec.appendChild(controls);
    sec.appendChild(controlsSec);

    // ── Status card ─────────────────────────────────────────────
    const statusSec = document.createElement("div");
    statusSec.className = "ops-section";

    const statusTitle = document.createElement("div");
    statusTitle.className = "ops-section-title";
    statusTitle.textContent = "Pipeline Status";
    statusSec.appendChild(statusTitle);

    const card = document.createElement("div");
    card.className = "ops-status-card";

    const statusHeader = document.createElement("div");
    statusHeader.className = "ops-status-header";

    const phaseRow = document.createElement("div");
    phaseRow.className = "ops-status-phase";
    elDot = document.createElement("span");
    elDot.className = "ops-phase-dot";
    elPhase = document.createElement("span");
    elPhase.textContent = "No run yet";
    phaseRow.appendChild(elDot);
    phaseRow.appendChild(elPhase);

    elElapsed = document.createElement("span");
    elElapsed.className = "ops-elapsed";

    statusHeader.appendChild(phaseRow);
    statusHeader.appendChild(elElapsed);
    card.appendChild(statusHeader);

    const counters = document.createElement("div");
    counters.className = "ops-counters";

    function makeCounter(id, label, colorClass) {
      const c = document.createElement("div");
      c.className = "ops-counter";
      const val = document.createElement("div");
      val.className = "ops-counter-val" + (colorClass ? " " + colorClass : "");
      val.id = id;
      val.textContent = "—";
      const lbl = document.createElement("div");
      lbl.className = "ops-counter-label";
      lbl.textContent = label;
      c.appendChild(val);
      c.appendChild(lbl);
      counters.appendChild(c);
      return val;
    }

    elRequested = makeCounter("ops-c-requested", "Requested", "muted");
    elEnqueued  = makeCounter("ops-c-enqueued",  "Enqueued",  "");
    elClaimed   = makeCounter("ops-c-claimed",   "Processed", "");
    elSucceeded = makeCounter("ops-c-succeeded", "Succeeded", "success");
    elFailed    = makeCounter("ops-c-failed",    "Failed",    "failed");

    card.appendChild(counters);

    elBanner = document.createElement("div");
    elBanner.className = "ops-banner";
    elBanner.style.display = "none";
    card.appendChild(elBanner);

    statusSec.appendChild(card);
    sec.appendChild(statusSec);

    // ── Provider usage ───────────────────────────────────────────
    const usageSec = document.createElement("div");
    usageSec.className = "ops-section";

    const usageTitle = document.createElement("div");
    usageTitle.className = "ops-section-title";
    usageTitle.textContent = "Provider Usage";
    usageSec.appendChild(usageTitle);

    const tbl = document.createElement("table");
    tbl.className = "ops-usage-table";
    tbl.innerHTML =
      "<thead><tr>" +
        "<th>Provider</th><th>Today (req)</th><th>Quota / Spend</th>" +
        "<th>Remaining</th><th>Est. Hotels</th><th>Status</th>" +
      "</tr></thead>";
    elUsageBody = document.createElement("tbody");
    tbl.appendChild(elUsageBody);
    usageSec.appendChild(tbl);

    elUsageNote = document.createElement("div");
    elUsageNote.className = "ops-usage-note";
    elUsageNote.innerHTML =
      '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
      " Usage figures are database-derived from today's actual API calls. One hotel scan ≈ 1 DataForSEO request + 1 Groq (LLM key 2) request.";
    usageSec.appendChild(elUsageNote);

    sec.appendChild(usageSec);
    return sec;
  }

  function buildFooter() {
    const footer = document.createElement("div");
    footer.className = "ops-footer";

    const left = document.createElement("div");
    left.className = "ops-footer-left";

    const logoutBtn = document.createElement("button");
    logoutBtn.className = "ops-btn ops-btn-ghost";
    logoutBtn.textContent = "Sign out";
    logoutBtn.addEventListener("click", logout);
    left.appendChild(logoutBtn);

    const note = document.createElement("span");
    note.className = "ops-session-note";
    note.textContent = "Session expires in 4 h · All pipeline calls are server-side";

    footer.appendChild(left);
    footer.appendChild(note);
    return footer;
  }

  // ── Panel open / close ────────────────────────────────────────
  function openPanel() {
    state.isOpen = true;
    overlay.classList.add("ops-visible");
    document.body.style.overflow = "hidden";
    if (!state.isAuthed) {
      authInput.focus();
    }
  }

  function closePanel() {
    state.isOpen = false;
    overlay.classList.remove("ops-visible");
    document.body.style.overflow = "";
  }

  // ── Auth ──────────────────────────────────────────────────────
  function checkSession() {
    // Fire a lightweight GET — if the server honours our session cookie
    // it returns 200; 401 means we need to log in.
    fetch("/api/admin/run", { method: "GET", credentials: "same-origin" })
      .then(function (r) {
        if (r.ok) {
          return r.json().then(function (body) {
            setAuthed(true);
            if (body && body.run) applyResult(body);
          });
        }
        setAuthed(false);
      })
      .catch(function () { setAuthed(false); });
  }

  function setAuthed(yes) {
    state.isAuthed = yes;
    if (yes) {
      authSection.style.display = "none";
      opsSection.style.display = "";
    } else {
      authSection.style.display = "";
      opsSection.style.display = "none";
    }
  }

  function submitAuth() {
    const pw = authInput.value;
    if (!pw) return;

    authBtn.disabled = true;
    authBtn.textContent = "Checking…";
    setAuthError("");

    fetch("/api/admin/auth", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    })
      .then(function (r) {
        authBtn.disabled = false;
        authBtn.textContent = "Unlock";
        if (r.ok) {
          authInput.value = "";
          setAuthed(true);
          // Refresh usage on first entry
          refreshStatus();
        } else {
          setAuthError("Access denied.");
          authInput.select();
        }
      })
      .catch(function () {
        authBtn.disabled = false;
        authBtn.textContent = "Unlock";
        setAuthError("Network error. Please try again.");
      });
  }

  function setAuthError(msg) {
    if (msg) {
      authError.textContent = msg;
      authError.style.display = "";
    } else {
      authError.style.display = "none";
    }
  }

  function logout() {
    fetch("/api/admin/auth", { method: "DELETE", credentials: "same-origin" })
      .finally(function () {
        state.isAuthed = false;
        state.currentRun = null;
        stopTimer();
        setAuthed(false);
        resetCounters();
        authInput.value = "";
      });
  }

  // ── Run pipeline ──────────────────────────────────────────────
  function startRun() {
    const count = parseInt(countInput.value, 10);
    if (!count || count < 1 || count > 500) {
      showBanner("warn", "Please enter a number between 1 and 500.");
      return;
    }

    state.isRunning = true;
    state.startedAt = new Date();
    runBtn.disabled = true;
    countInput.disabled = true;
    hideBanner();
    resetCounters();
    setPhase("starting", "running");
    startTimer();

    fetch("/api/admin/run", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", count: count }),
    })
      .then(function (r) {
        if (r.status === 401) { handleAuthExpired(); return null; }
        if (!r.ok) {
          return r.json().then(function (b) {
            throw new Error((b && b.error && b.error.message) || ("HTTP " + r.status));
          });
        }
        return r.json();
      })
      .then(function (body) {
        if (!body) return;
        applyResult(body);
        if (body.run && body.run.status === "running") {
          scheduleStep(body.run.id);
        } else {
          finishRun();
        }
      })
      .catch(function (err) {
        showBanner("error", "Failed to start pipeline: " + err.message);
        finishRun();
      });
  }

  function scheduleStep(runId) {
    if (state.stepPending) return;
    state.stepPending = true;

    // Brief pause between steps so the UI can update
    setTimeout(function () {
      doStep(runId);
    }, 300);
  }

  function doStep(runId) {
    fetch("/api/admin/run", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "step", runId: runId }),
    })
      .then(function (r) {
        state.stepPending = false;
        if (r.status === 401) { handleAuthExpired(); return null; }
        if (r.status === 504) {
          // Function timeout — the hotel may still be processing on the server.
          // Wait a moment and continue stepping; the queue's stale-job recovery
          // will handle any job that was mid-flight.
          showBanner("warn", "Step timed out — retrying…");
          setTimeout(function () { scheduleStep(runId); }, 2000);
          return null;
        }
        if (!r.ok) {
          return r.json().then(function (b) {
            throw new Error((b && b.error && b.error.message) || ("HTTP " + r.status));
          });
        }
        return r.json();
      })
      .then(function (body) {
        if (!body) return;
        applyResult(body);
        const run = body.run;
        if (run && run.status === "running") {
          scheduleStep(run.id);
        } else {
          finishRun();
        }
      })
      .catch(function (err) {
        state.stepPending = false;
        showBanner("error", "Step error: " + err.message + ". Pipeline may have partially completed.");
        finishRun();
      });
  }

  function finishRun() {
    state.isRunning = false;
    runBtn.disabled = false;
    countInput.disabled = false;
    stopTimer();
  }

  function handleAuthExpired() {
    finishRun();
    setAuthed(false);
    showBanner("error", "Session expired. Please log in again.");
  }

  function refreshStatus() {
    fetch("/api/admin/run", { method: "GET", credentials: "same-origin" })
      .then(function (r) {
        if (r.ok) return r.json().then(applyResult);
      })
      .catch(function () {});
  }

  // ── Result application ────────────────────────────────────────
  function applyResult(body) {
    const run = body && body.run;
    const usage = body && body.usage;
    const depth = body && body.queueSnapshot;

    if (run) {
      state.currentRun = run;
      renderRunState(run);
    }
    if (usage) {
      renderUsage(usage);
    }
    // Queue depth not shown separately but depth is available if needed
  }

  function renderRunState(run) {
    // Counters
    setCounter(elRequested, run.requestedCount);
    setCounter(elEnqueued, run.enqueuedCount);
    setCounter(elClaimed, run.claimedCount);
    setCounter(elSucceeded, run.succeededCount);
    setCounter(elFailed, run.failedCount);

    // Phase + dot
    switch (run.status) {
      case "running":
        if (run.phase === "enqueue") {
          setPhase("Phase 1 / 2 — Enqueueing", "running");
        } else if (run.phase === "worker") {
          setPhase("Phase 2 / 2 — Enriching", "running");
        } else {
          setPhase("Running…", "running");
        }
        hideBanner();
        break;

      case "completed":
        setPhase("Completed", "done");
        showBanner("success", "Pipeline finished. All " + run.succeededCount + " hotels enriched successfully.");
        break;

      case "partial":
        setPhase("Completed (with failures)", "warn");
        showBanner("warn",
          run.succeededCount + " hotels enriched; " + run.failedCount +
          " failed (they stay in queue for automatic retry)."
        );
        break;

      case "quota_halted":
        setPhase("Stopped — quota reached", "error");
        showBanner("error",
          "Pipeline stopped because " + (run.haltedBy || "a provider") +
          " reached its available quota. Remaining hotels are still queued and will be processed next run."
        );
        break;

      case "failed":
        setPhase("Failed", "error");
        showBanner("error", run.errorMessage || "Pipeline encountered an unrecoverable error.");
        break;

      default:
        setPhase(run.status, "");
    }
  }

  function setCounter(el, val) {
    el.textContent = (val !== null && val !== undefined) ? String(val) : "—";
  }

  function setPhase(label, dotClass) {
    elPhase.textContent = label;
    elDot.className = "ops-phase-dot" + (dotClass ? " " + dotClass : "");
  }

  function resetCounters() {
    [elRequested, elEnqueued, elClaimed, elSucceeded, elFailed].forEach(function (el) {
      el.textContent = "—";
    });
    setPhase("No run yet", "");
    hideBanner();
  }

  function showBanner(type, msg) {
    elBanner.style.display = "";
    elBanner.className = "ops-banner ops-banner-" + type;
    elBanner.textContent = msg;
  }

  function hideBanner() {
    elBanner.style.display = "none";
  }

  // ── Provider usage rendering ──────────────────────────────────
  function renderUsage(usage) {
    if (!elUsageBody) return;

    // Per-hotel costs:
    //   DataForSEO: 1 request per hotel
    //   Groq key 2 (nvidia_key_2): 1 request per hotel (summary)
    //   Groq key 1 (nvidia_key_1): used only for search queries, not ingestion
    const providers = [
      {
        key: "dataforseo",
        label: "DataForSEO",
        alias: "dataforseo",
        type: "cost",        // monthly cost gate
        reqPerHotel: 1,
      },
      {
        key: "nvidia_key_2",
        label: "Groq (LLM — ingestion)",
        alias: "groq_key_2",
        type: "requests",    // daily request quota
        reqPerHotel: 1,
      },
      {
        key: "nvidia_key_1",
        label: "Groq (LLM — search)",
        alias: "groq_key_1",
        type: "requests",
        reqPerHotel: 0,      // not consumed during ingestion
      },
    ];

    elUsageBody.innerHTML = "";

    providers.forEach(function (p) {
      const data = usage[p.key];
      const tr = document.createElement("tr");

      // Provider name + alias
      const tdName = document.createElement("td");
      const nameSpan = document.createElement("span");
      nameSpan.className = "ops-provider-name";
      nameSpan.textContent = p.label;
      const aliasDiv = document.createElement("div");
      aliasDiv.style.fontSize = "11px";
      aliasDiv.style.color = "var(--text-muted)";
      aliasDiv.textContent = p.alias;
      tdName.appendChild(nameSpan);
      tdName.appendChild(aliasDiv);
      tr.appendChild(tdName);

      if (!data) {
        appendCells(tr, ["—", "—", "—", "—"]);
        appendStatusCell(tr, "unknown", "Unknown");
        elUsageBody.appendChild(tr);
        return;
      }

      const today = data.today;
      const limits = data.limits;
      const month = data.month;

      if (p.type === "cost") {
        // DataForSEO — monthly cost gate
        const spent = month ? fmtCurrency(month.costUsd) : "—";
        const hard = limits ? fmtCurrency(limits.hardStopUsd) : "—";
        const warnAt = limits ? limits.warnAtUsd : null;
        const monthlyCost = month ? month.costUsd : 0;
        const hardStop = limits ? limits.hardStopUsd : Infinity;
        const remaining = hardStop !== Infinity ? Math.max(0, hardStop - monthlyCost) : null;
        const estHotels = (remaining !== null && p.reqPerHotel > 0)
          ? "~" + Math.floor(remaining / 0.002)
          : "—";
        const blocked = limits && limits.blocked;
        const nearWarn = warnAt !== null && monthlyCost >= warnAt * 0.8;

        const todayReq = today ? String(today.requests) : "0";
        appendCells(tr, [
          todayReq,
          spent + " / " + hard + " (month)",
          remaining !== null ? fmtCurrency(remaining) : "—",
          estHotels,
        ]);
        appendStatusCell(tr,
          blocked ? "blocked" : (nearWarn ? "warn" : "ok"),
          blocked ? "Blocked" : (nearWarn ? "Near limit" : "Healthy"),
        );
      } else {
        // NVIDIA/Groq — daily request quota
        const quota = limits ? limits.dailyRequestQuota : null;
        const todayReqs = today ? today.requests : 0;
        const gateAt = quota ? Math.floor(quota * 0.8) : null;
        const remaining = gateAt !== null ? Math.max(0, gateAt - todayReqs) : null;
        const estHotels = (remaining !== null && p.reqPerHotel > 0)
          ? "~" + remaining
          : p.reqPerHotel === 0 ? "N/A" : "—";
        const blocked = gateAt !== null && todayReqs >= gateAt;
        const nearLimit = gateAt !== null && todayReqs >= gateAt * 0.75;

        appendCells(tr, [
          String(todayReqs),
          quota ? (todayReqs + " / " + gateAt + " gate (" + quota + " limit)") : "—",
          remaining !== null ? String(remaining) + " req" : "—",
          estHotels,
        ]);
        appendStatusCell(tr,
          blocked ? "blocked" : (nearLimit ? "warn" : "ok"),
          blocked ? "Blocked" : (nearLimit ? "Near gate" : "Healthy"),
        );
      }

      elUsageBody.appendChild(tr);
    });
  }

  function appendCells(tr, values) {
    values.forEach(function (v) {
      const td = document.createElement("td");
      td.textContent = v;
      tr.appendChild(td);
    });
  }

  function appendStatusCell(tr, type, label) {
    const td = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = "ops-status-pill " + {
      ok: "ops-pill-ok",
      warn: "ops-pill-warn",
      blocked: "ops-pill-blocked",
      unknown: "ops-pill-unknown",
    }[type];
    pill.textContent = label;
    td.appendChild(pill);
    tr.appendChild(td);
  }

  function fmtCurrency(v) {
    if (v === null || v === undefined) return "—";
    return "$" + Number(v).toFixed(2);
  }

  // ── Elapsed timer ─────────────────────────────────────────────
  function startTimer() {
    stopTimer();
    state.timerInterval = setInterval(function () {
      if (!state.startedAt) return;
      const sec = Math.floor((Date.now() - state.startedAt.getTime()) / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      elElapsed.textContent = pad(m) + ":" + pad(s);
    }, 1000);
  }

  function stopTimer() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }

  function pad(n) { return n < 10 ? "0" + n : String(n); }

  // ── Init ──────────────────────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
