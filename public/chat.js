// ═══════════════════════════════════════════════════════════════
//  Storage layer — UNCHANGED CONTRACT
//  key: "hiq_chats"  →  Chat[]
//  Chat { id, title, messages, createdAt, updatedAt }
//  Message { role, type, content?, reply?, results? }
//  This shape and key are relied on by the backend-adjacent code and
//  must not change as part of the visual redesign.
// ═══════════════════════════════════════════════════════════════
const STORAGE_KEY = "hiq_chats";

function getChats() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

function saveChats(chats) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
}

function addChat(chat) {
  const chats = getChats();
  chats.unshift(chat);
  saveChats(chats);
}

function updateChat(chatId, messages) {
  const chats = getChats();
  const idx = chats.findIndex(c => c.id === chatId);
  if (idx === -1) return;
  chats[idx].messages = messages;
  chats[idx].updatedAt = Date.now();
  saveChats(chats);
}

function getChatById(id) {
  return getChats().find(c => c.id === id) || null;
}

function createChatId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ═══════════════════════════════════════════════════════════════
//  Presentation-only preferences (new — separate keys, never touch
//  hiq_chats so existing stored conversations are unaffected)
// ═══════════════════════════════════════════════════════════════
const THEME_KEY        = "hiq_theme";
const SIDEBAR_KEY      = "hiq_sidebar_collapsed";
const RESULTS_VIEW_KEY = "hiq_results_view"; // "cards" | "table"

function getTheme() {
  try { return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light"; }
  catch { return "light"; }
}
function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
  const label = document.querySelector(".theme-toggle-label");
  if (label) label.textContent = theme === "dark" ? "Dark mode" : "Light mode";
}
function getDefaultResultsView() {
  try { return localStorage.getItem(RESULTS_VIEW_KEY) === "table" ? "table" : "cards"; }
  catch { return "cards"; }
}
function setDefaultResultsView(view) {
  try { localStorage.setItem(RESULTS_VIEW_KEY, view); } catch {}
}

// ═══════════════════════════════════════════════════════════════
//  Session state
// ═══════════════════════════════════════════════════════════════
let currentChatId  = null;
let currentMessages = [];   // in-memory mirror of active chat's messages[]

// ═══════════════════════════════════════════════════════════════
//  DOM refs
// ═══════════════════════════════════════════════════════════════
const chatContainer     = document.getElementById("chat-container");
const messageInput      = document.getElementById("message-input");
const sendButton        = document.getElementById("send-button");
const sidebar           = document.getElementById("sidebar");
const sidebarOverlay    = document.getElementById("sidebar-overlay");
const menuBtn           = document.getElementById("menu-btn");
const newChatBtn        = document.getElementById("new-chat-btn");
const chatHistory       = document.getElementById("chat-history");
const themeToggleBtn    = document.getElementById("theme-toggle-btn");
const sidebarCollapseBtn = document.getElementById("sidebar-collapse-btn");
const kbdHint           = document.getElementById("kbd-hint");

// ═══════════════════════════════════════════════════════════════
//  Theme + sidebar collapse init
// ═══════════════════════════════════════════════════════════════
setTheme(getTheme());
themeToggleBtn.addEventListener("click", () => setTheme(getTheme() === "dark" ? "light" : "dark"));

try {
  if (localStorage.getItem(SIDEBAR_KEY) === "1") sidebar.classList.add("collapsed");
} catch {}
sidebarCollapseBtn.addEventListener("click", () => {
  sidebar.classList.toggle("collapsed");
  try { localStorage.setItem(SIDEBAR_KEY, sidebar.classList.contains("collapsed") ? "1" : "0"); } catch {}
});

if (kbdHint) kbdHint.textContent = /Mac/i.test(navigator.platform || "") ? "⌘ + Enter" : "Enter";

// ═══════════════════════════════════════════════════════════════
//  Sidebar open / close (mobile)
// ═══════════════════════════════════════════════════════════════
menuBtn.addEventListener("click", () => {
  sidebar.classList.add("open");
  sidebarOverlay.classList.add("open");
});

sidebarOverlay.addEventListener("click", closeSidebar);

function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("open");
}

// ═══════════════════════════════════════════════════════════════
//  Sidebar — render history list
// ═══════════════════════════════════════════════════════════════
function renderSidebar() {
  const chats = getChats().sort((a, b) => b.updatedAt - a.updatedAt);
  chatHistory.innerHTML = "";

  if (chats.length === 0) {
    chatHistory.innerHTML = '<div class="history-empty">No recent searches</div>';
    return;
  }

  chats.forEach(chat => {
    const item = document.createElement("div");
    item.className = "history-item" + (chat.id === currentChatId ? " active" : "");
    item.dataset.chatId = chat.id;
    item.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span>${chat.title.length > 34 ? chat.title.slice(0, 34) + "…" : chat.title}</span>
    `;
    item.addEventListener("click", () => loadChat(chat.id));
    chatHistory.appendChild(item);
  });
}

// ═══════════════════════════════════════════════════════════════
//  Load a past chat
// ═══════════════════════════════════════════════════════════════
function loadChat(id) {
  const chat = getChatById(id);
  if (!chat) return;

  currentChatId   = id;
  currentMessages = [...chat.messages];

  chatHistory.querySelectorAll(".history-item").forEach(el => {
    el.classList.toggle("active", el.dataset.chatId === id);
  });

  chatContainer.innerHTML = "";
  currentMessages.forEach(msg => renderMessage(msg, false));
  chatContainer.scrollTop = chatContainer.scrollHeight;

  closeSidebar();
  messageInput.focus();
}

// ═══════════════════════════════════════════════════════════════
//  New chat
// ═══════════════════════════════════════════════════════════════
newChatBtn.addEventListener("click", () => {
  currentChatId   = null;
  currentMessages = [];
  chatContainer.innerHTML = "";
  showEmptyState();
  renderSidebar();
  closeSidebar();
  messageInput.focus();
});

// ═══════════════════════════════════════════════════════════════
//  Empty / welcome state
// ═══════════════════════════════════════════════════════════════
function showEmptyState() {
  const div = document.createElement("div");
  div.id = "empty-state";
  div.className = "empty-state";
  div.innerHTML = `
    <div class="empty-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 20V9.5L12 4l8 5.5V20"/>
        <path d="M9 20v-6h6v6"/>
      </svg>
    </div>
    <h2 class="empty-title">Find any hotel, instantly enriched</h2>
    <p class="empty-desc">Search by hotel name and city — ratings, room types, facilities, nearby transit, and an AI-written summary in seconds.</p>
    <div class="suggestion-grid">
      <button class="suggestion-chip">Family hotels in Barcelona</button>
      <button class="suggestion-chip">5-star hotels in Paris</button>
      <button class="suggestion-chip">Boutique hotels in Kyoto</button>
      <button class="suggestion-chip">Budget hotels in London</button>
    </div>
  `;
  bindSuggestionChips(div);
  chatContainer.appendChild(div);
}

function hideEmptyState() {
  const es = document.getElementById("empty-state");
  if (!es) return;
  es.style.transition = "opacity 180ms ease, transform 180ms ease";
  es.style.opacity    = "0";
  es.style.transform  = "translateY(-8px)";
  setTimeout(() => es.remove(), 200);
}

// ═══════════════════════════════════════════════════════════════
//  Suggestion chips
// ═══════════════════════════════════════════════════════════════
function bindSuggestionChips(container) {
  container.querySelectorAll(".suggestion-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      messageInput.value = chip.textContent.trim();
      messageInput.dispatchEvent(new Event("input"));
      messageInput.focus();
    });
  });
}

const initialEmptyState = document.getElementById("empty-state");
if (initialEmptyState) bindSuggestionChips(initialEmptyState);

// ═══════════════════════════════════════════════════════════════
//  Auto-resize textarea
// ═══════════════════════════════════════════════════════════════
messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 140) + "px";
});

// ═══════════════════════════════════════════════════════════════
//  Formatting helpers (pure — do not alter underlying field values)
// ═══════════════════════════════════════════════════════════════
function fmtRating(v)      { return v !== null && v !== undefined ? Number(v).toFixed(1) : "—"; }
function fmtReviews(v)     { return v !== null && v !== undefined ? v.toLocaleString() + " reviews" : "No reviews yet"; }
function fmtRooms(v)       { return v !== null && v !== undefined ? String(v) : "—"; }
function fmtBool(v)        { return v === true ? "Yes" : v === false ? "No" : "Unknown"; }
function dotClass(v)       { return v === true ? "yes" : v === false ? "no" : "unknown"; }
function fmtCity(h)        { return h.city || h.location || "—"; }
function transitLines(v)   { return v ? v.split(/,\s*/).map(s => s.trim()).filter(Boolean) : []; }

const TRANSIT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0-7-4.5-9-9-9s-9 2-9 9a9 9 0 0 0 9 9 9 9 0 0 0 9-9z"/><circle cx="12" cy="10" r="3"/></svg>`;
const SPARKLE_ICON  = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.6 5.2L19 9l-5.4 1.8L12 16l-1.6-5.2L5 9l5.4-1.8z"/></svg>`;

// ═══════════════════════════════════════════════════════════════
//  Unified message renderer
// ═══════════════════════════════════════════════════════════════
function renderMessage(msg, animate = true) {
  if (msg.type === "results") {
    renderHotelList(msg.reply, msg.results, animate);
  } else {
    renderTextMessage(msg.content, msg.role, animate);
  }
}

function renderTextMessage(text, role, animate = true) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;
  if (!animate) wrapper.style.animation = "none";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  wrapper.appendChild(bubble);

  chatContainer.appendChild(wrapper);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return wrapper;
}

// ── Staged "researching" indicator (cosmetic only — actual
//    completion is still driven by the real fetch resolving) ──
function renderSearchingCard(queryText) {
  const wrapper = document.createElement("div");
  wrapper.className = "message bot";

  const card = document.createElement("div");
  card.className = "searching-card";

  const title = document.createElement("div");
  title.className = "searching-title";
  title.textContent = `Researching "${queryText}"…`;
  card.appendChild(title);

  const stageLabels = ["Searching Google & partner sites", "Extracting facts & preparing your report"];
  const stageEls = stageLabels.map((label, i) => {
    const row = document.createElement("div");
    row.className = "searching-stage" + (i === 0 ? " active" : "");
    row.innerHTML = `<span class="stage-icon"><span class="spinner"></span></span><span class="stage-label">${label}</span>`;
    card.appendChild(row);
    return row;
  });

  wrapper.appendChild(card);
  chatContainer.appendChild(wrapper);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  const timer = setTimeout(() => {
    if (!stageEls[0].isConnected) return;
    stageEls[0].classList.remove("active");
    stageEls[0].classList.add("done");
    stageEls[0].querySelector(".stage-icon").innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    stageEls[1].classList.add("active");
  }, 1100);

  wrapper._clearTimer = () => clearTimeout(timer);
  return wrapper;
}

function renderErrorMessage(text, onRetry) {
  const wrapper = document.createElement("div");
  wrapper.className = "message bot error";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
    <span>${text}</span>
  `;
  const retryBtn = document.createElement("button");
  retryBtn.className = "retry-btn";
  retryBtn.textContent = "Retry";
  retryBtn.addEventListener("click", onRetry);
  bubble.appendChild(retryBtn);

  wrapper.appendChild(bubble);
  chatContainer.appendChild(wrapper);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return wrapper;
}

function showToast(text) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

// ═══════════════════════════════════════════════════════════════
//  Export helpers (client-side only — no backend/API involved)
// ═══════════════════════════════════════════════════════════════
function exportResultsCSV(results) {
  const headers = ["Hotel Name", "City", "Rating", "Reviews", "Rooms", "Family Rooms", "Connected Rooms", "Facilities", "Nearby Transit", "AI Summary"];
  const esc = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const lines = [headers.map(esc).join(",")];
  results.forEach(h => {
    lines.push([
      h.hotel_name, fmtCity(h), h.rating, h.rating_count, h.number_of_rooms,
      fmtBool(h.family_rooms), fmtBool(h.connected_rooms),
      Array.isArray(h.facilities) ? h.facilities.join("; ") : "",
      h.nearby_transit || "", h.ai_summary || ""
    ].map(esc).join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "hotel-intelligence-results.csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("CSV downloaded");
}

function exportResultsMarkdown(results) {
  let md = "| Hotel | City | Rating | Rooms | Family | Connected | Summary |\n|---|---|---|---|---|---|---|\n";
  results.forEach(h => {
    md += `| ${h.hotel_name} | ${fmtCity(h)} | ${h.rating ?? "—"} | ${h.number_of_rooms ?? "—"} | ${fmtBool(h.family_rooms)} | ${fmtBool(h.connected_rooms)} | ${(h.ai_summary || "").replace(/\|/g, "/")} |\n`;
  });
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(md).then(() => showToast("Copied as Markdown")).catch(() => showToast("Copy failed"));
  } else {
    showToast("Clipboard unavailable");
  }
}

// ═══════════════════════════════════════════════════════════════
//  Hotel results — cards (default) with a table density toggle.
//  All fields from the API response are always rendered; only the
//  layout/view differs.
// ═══════════════════════════════════════════════════════════════
function renderHotelList(reply, results, animate = true) {
  const wrapper = document.createElement("div");
  wrapper.className = "message bot results-message";
  if (!animate) wrapper.style.animation = "none";

  const toolbar = document.createElement("div");
  toolbar.className = "results-toolbar";

  const summary = document.createElement("div");
  summary.className = "reply-summary";
  summary.textContent = reply;
  toolbar.appendChild(summary);

  const hasResults = results && results.length > 0;

  if (hasResults) {
    const controls = document.createElement("div");
    controls.className = "toolbar-controls";

    let view = getDefaultResultsView();

    const viewToggle = document.createElement("div");
    viewToggle.className = "view-toggle";
    const cardsBtn = document.createElement("button");
    cardsBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
    cardsBtn.setAttribute("aria-label", "Card view");
    const tableBtn = document.createElement("button");
    tableBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
    tableBtn.setAttribute("aria-label", "Table view");
    viewToggle.appendChild(cardsBtn);
    viewToggle.appendChild(tableBtn);

    const exportWrap = document.createElement("div");
    exportWrap.className = "export-wrap";
    const exportBtn = document.createElement("button");
    exportBtn.className = "export-btn";
    exportBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Export</span>';
    const exportMenu = document.createElement("div");
    exportMenu.className = "export-menu";
    const csvBtn = document.createElement("button");
    csvBtn.textContent = "Export as CSV";
    csvBtn.addEventListener("click", () => { exportMenu.classList.remove("open"); exportResultsCSV(results); });
    const mdBtn = document.createElement("button");
    mdBtn.textContent = "Copy as Markdown";
    mdBtn.addEventListener("click", () => { exportMenu.classList.remove("open"); exportResultsMarkdown(results); });
    exportMenu.appendChild(csvBtn);
    exportMenu.appendChild(mdBtn);
    exportBtn.addEventListener("click", (e) => { e.stopPropagation(); exportMenu.classList.toggle("open"); });
    document.addEventListener("click", () => exportMenu.classList.remove("open"));
    exportWrap.appendChild(exportBtn);
    exportWrap.appendChild(exportMenu);

    controls.appendChild(viewToggle);
    controls.appendChild(exportWrap);
    toolbar.appendChild(controls);

    const body = document.createElement("div");

    function paint() {
      cardsBtn.classList.toggle("active", view === "cards");
      tableBtn.classList.toggle("active", view === "table");
      body.innerHTML = "";
      body.appendChild(view === "cards" ? buildGrid(results) : buildTable(results));
    }
    cardsBtn.addEventListener("click", () => { view = "cards"; setDefaultResultsView(view); paint(); });
    tableBtn.addEventListener("click", () => { view = "table"; setDefaultResultsView(view); paint(); });
    paint();

    wrapper.appendChild(toolbar);
    wrapper.appendChild(body);
  } else {
    wrapper.appendChild(toolbar);
    wrapper.appendChild(buildNoResultsPanel());
  }

  chatContainer.appendChild(wrapper);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return wrapper;
}

function buildNoResultsPanel() {
  const panel = document.createElement("div");
  panel.className = "no-results-panel";
  panel.innerHTML = `
    <div class="no-results-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
    </div>
    <h3>No matches yet</h3>
    <p>Try a different city or hotel name — coverage grows as the pipeline enriches more hotels.</p>
  `;
  return panel;
}

// ── Badge computation — data-driven, no fabrication ───────────
function computeBadges(results) {
  const badges = new Array(results.length).fill(null);

  // Single result: only award "Highly Rated" if it qualifies
  if (results.length < 2) {
    if (results.length === 1 && results[0].rating !== null && results[0].rating !== undefined && results[0].rating >= 8.0) {
      badges[0] = "Highly Rated";
    }
    return badges;
  }

  // Pass 1: Highly Rated — rating >= 8.0
  results.forEach((h, i) => {
    if (h.rating !== null && h.rating !== undefined && h.rating >= 8.0) badges[i] = "Highly Rated";
  });

  // Pass 2: Top Reviewed — highest review count among unbadged
  let topRevIdx = -1, maxRev = 0;
  results.forEach((h, i) => {
    if (!badges[i] && h.rating_count !== null && h.rating_count !== undefined && h.rating_count > maxRev) {
      maxRev = h.rating_count; topRevIdx = i;
    }
  });
  if (topRevIdx !== -1 && maxRev > 0) badges[topRevIdx] = "Top Reviewed";

  // Pass 3: Best Rated — highest rating among unbadged
  let bestIdx = -1, bestRating = -1;
  results.forEach((h, i) => {
    if (!badges[i] && h.rating !== null && h.rating !== undefined && h.rating > bestRating) {
      bestRating = h.rating; bestIdx = i;
    }
  });
  if (bestIdx !== -1) badges[bestIdx] = "Best Rated";

  return badges;
}

// ── Gradient seed for placeholder (hashes hotel name → one of 6 palettes) ──
function hotelGradient(name) {
  const GRADIENTS = [
    "linear-gradient(145deg, #1a3051 0%, #0d1e38 100%)",
    "linear-gradient(145deg, #1a3028 0%, #0d2019 100%)",
    "linear-gradient(145deg, #30201a 0%, #200d0d 100%)",
    "linear-gradient(145deg, #2a1a30 0%, #1a0d20 100%)",
    "linear-gradient(145deg, #1a2a30 0%, #0d1820 100%)",
    "linear-gradient(145deg, #302a1a 0%, #201a0d 100%)",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xfffffff;
  return GRADIENTS[h % GRADIENTS.length];
}

// ── 2-column hotel grid ────────────────────────────────────────
function buildGrid(results) {
  const badges = computeBadges(results);
  const grid = document.createElement("div");
  grid.className = "hotel-grid";
  results.forEach((h, i) => grid.appendChild(buildGridCard(h, badges[i])));
  return grid;
}

function safeUrl(url) {
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") ? url : "#";
  } catch { return "#"; }
}

function buildGridCard(h, badge) {
  const card = document.createElement("article");
  card.className = "hotel-grid-card";
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-label", h.hotel_name);

  const facilities = Array.isArray(h.facilities) && h.facilities.length ? h.facilities : [];
  const hasImage   = Array.isArray(h.images) && h.images.length > 0;

  // ── Image area ───────────────────────────────────────────────
  const imageWrap = document.createElement("div");
  imageWrap.className = "hgc-image-wrap";

  if (hasImage) {
    const img = document.createElement("img");
    img.className = "hgc-image";
    img.src       = h.images[0];
    img.alt       = h.hotel_name;
    img.loading   = "lazy";
    imageWrap.appendChild(img);
  } else {
    const ph = document.createElement("div");
    ph.className  = "hgc-placeholder";
    ph.style.background = hotelGradient(h.hotel_name);
    const abbr = document.createElement("span");
    abbr.className = "hgc-placeholder-text";
    abbr.textContent = h.hotel_name.split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase();
    ph.appendChild(abbr);
    imageWrap.appendChild(ph);
  }

  if (badge) {
    const badgeEl = document.createElement("span");
    badgeEl.className = "hgc-badge hgc-badge--"
      + (badge === "Highly Rated" ? "emerald" : badge === "Top Reviewed" ? "accent" : "amber");
    badgeEl.textContent = badge;
    imageWrap.appendChild(badgeEl);
  }

  card.appendChild(imageWrap);

  // ── Body ─────────────────────────────────────────────────────
  const body = document.createElement("div");
  body.className = "hgc-body";

  // Name + rating
  const nameRow = document.createElement("div");
  nameRow.className = "hgc-name-row";

  const nameEl = document.createElement("h3");
  nameEl.className  = "hgc-name";
  nameEl.textContent = h.hotel_name;
  nameRow.appendChild(nameEl);

  const ratingEl = document.createElement("span");
  ratingEl.className  = "hgc-rating";
  ratingEl.textContent = fmtRating(h.rating);
  nameRow.appendChild(ratingEl);

  body.appendChild(nameRow);

  // Location
  const locEl = document.createElement("div");
  locEl.className = "hgc-location";
  locEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11" aria-hidden="true"><path d="M21 10c0-7-4.5-9-9-9s-9 2-9 9a9 9 0 0 0 9 9 9 9 0 0 0 9-9z"/><circle cx="12" cy="10" r="3"/></svg>`;
  const locText = document.createElement("span");
  locText.className  = "hgc-location-text";
  const cityParts = [h.city, h.country].filter(Boolean);
  locText.textContent = cityParts.length ? cityParts.join(", ") : (h.location || "");
  locEl.appendChild(locText);
  body.appendChild(locEl);

  // Review count
  if (h.rating_count !== null && h.rating_count !== undefined) {
    const rev = document.createElement("div");
    rev.className  = "hgc-reviews";
    rev.textContent = fmtReviews(h.rating_count);
    body.appendChild(rev);
  }

  // Amenity chips (up to 4 visible + overflow count)
  if (facilities.length) {
    const amenities = document.createElement("div");
    amenities.className = "hgc-amenities";
    facilities.slice(0, 4).forEach(f => {
      const chip = document.createElement("span");
      chip.className  = "hgc-chip";
      chip.textContent = f;
      amenities.appendChild(chip);
    });
    if (facilities.length > 4) {
      const more = document.createElement("span");
      more.className  = "hgc-chip hgc-chip-more";
      more.textContent = `+${facilities.length - 4}`;
      amenities.appendChild(more);
    }
    body.appendChild(amenities);
  }

  // Actions
  const actions = document.createElement("div");
  actions.className = "hgc-actions";

  const detailBtn = document.createElement("button");
  detailBtn.className  = "hgc-detail-btn";
  detailBtn.textContent = "View Details";
  detailBtn.addEventListener("click", e => { e.stopPropagation(); openHotelModal(h); });
  actions.appendChild(detailBtn);

  if (h.hotel_url) {
    const urlBtn = document.createElement("a");
    urlBtn.className = "hgc-url-btn";
    urlBtn.href      = safeUrl(h.hotel_url);
    urlBtn.target    = "_blank";
    urlBtn.rel       = "noopener noreferrer";
    urlBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="10" height="10" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
    const urlText = document.createElement("span");
    urlText.textContent = "Website";
    urlBtn.appendChild(urlText);
    urlBtn.addEventListener("click", e => e.stopPropagation());
    actions.appendChild(urlBtn);
  }

  body.appendChild(actions);
  card.appendChild(body);

  // Whole-card click + keyboard → opens modal
  card.addEventListener("click", () => openHotelModal(h));
  card.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openHotelModal(h); }
  });

  return card;
}

function buildTable(results) {
  const wrap = document.createElement("div");
  wrap.className = "hotel-table-wrap";

  const table = document.createElement("table");
  table.className = "hotel-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["Hotel Name","City","Rating","Reviews","Rooms","Family Rooms","Connected Rooms","Facilities","Nearby Transit","Summary"]
    .forEach(col => {
      const th = document.createElement("th");
      th.textContent = col;
      headerRow.appendChild(th);
    });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  results.forEach(h => {
    const tr = document.createElement("tr");
    const cells = [
      { val: h.hotel_name, cls: "name-cell" },
      { val: fmtCity(h), cls: "" },
      { val: fmtRating(h.rating), cls: "" },
      { val: h.rating_count !== null && h.rating_count !== undefined ? h.rating_count.toLocaleString() : "—", cls: "" },
      { val: fmtRooms(h.number_of_rooms), cls: "" },
      { val: fmtBool(h.family_rooms), cls: "" },
      { val: fmtBool(h.connected_rooms), cls: "" },
      { val: Array.isArray(h.facilities) && h.facilities.length ? h.facilities.join(", ") : "—", cls: "wrap-cell" },
      { val: h.nearby_transit || "—", cls: "wrap-cell" },
      { val: h.ai_summary || "—", cls: "wrap-cell" },
    ];
    cells.forEach(c => {
      const td = document.createElement("td");
      if (c.cls) td.className = c.cls;
      td.textContent = c.val;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

// ═══════════════════════════════════════════════════════════════
//  Hotel detail modal
// ═══════════════════════════════════════════════════════════════
let _hotelModalEl = null;

function ensureHotelModal() {
  if (_hotelModalEl) return _hotelModalEl;
  const overlay = document.createElement("div");
  overlay.className = "hotel-modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  const modal = document.createElement("div");
  modal.className = "hotel-modal";
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeHotelModal(); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && _hotelModalEl && _hotelModalEl.classList.contains("open")) closeHotelModal();
  });
  _hotelModalEl = overlay;
  return overlay;
}

function openHotelModal(h) {
  const overlay = ensureHotelModal();
  const modal = overlay.querySelector(".hotel-modal");

  const facilities = Array.isArray(h.facilities) && h.facilities.length ? h.facilities : [];
  const transit = transitLines(h.nearby_transit);
  const images = Array.isArray(h.images) && h.images.length ? h.images.slice(0, 6) : [];
  const landmarks = h.nearby_landmarks
    ? h.nearby_landmarks.split(/,\s*/).map(s => s.trim()).filter(Boolean) : [];

  const EXT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;

  modal.innerHTML = `
    <div class="hotel-modal-header">
      <div>
        <div class="hotel-modal-title hm-title"></div>
        <div class="hotel-modal-city hm-city"></div>
      </div>
      <button class="hotel-modal-close" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="hotel-modal-body">
      <div class="hm-rating-row">
        <div class="hm-rating-badge">${fmtRating(h.rating)}</div>
        <div class="hm-rating-text hm-reviews"></div>
      </div>
      <div class="hm-divider"></div>
      <div class="hm-section">
        <div class="hm-section-label">Room details</div>
        <div class="hm-stats-grid">
          <div class="hm-stat">
            <div class="hm-stat-label">Total rooms</div>
            <div class="hm-stat-value">${fmtRooms(h.number_of_rooms)}</div>
          </div>
          <div class="hm-stat">
            <div class="hm-stat-label">Family rooms</div>
            <div class="hm-stat-value"><span class="status-dot-sm ${dotClass(h.family_rooms)}"></span>${fmtBool(h.family_rooms)}</div>
          </div>
          <div class="hm-stat">
            <div class="hm-stat-label">Connected rooms</div>
            <div class="hm-stat-value"><span class="status-dot-sm ${dotClass(h.connected_rooms)}"></span>${fmtBool(h.connected_rooms)}</div>
          </div>
        </div>
      </div>
      ${facilities.length ? `
      <div class="hm-divider"></div>
      <div class="hm-section">
        <div class="hm-section-label">Facilities</div>
        <div class="hm-facilities">${facilities.map(() => `<span class="facility-chip hm-fc"></span>`).join("")}</div>
      </div>` : ""}
      ${transit.length ? `
      <div class="hm-divider"></div>
      <div class="hm-section">
        <div class="hm-section-label">Nearby transit</div>
        <div class="hm-transit">${transit.map(() => `<div class="transit-line">${TRANSIT_ICON}<span class="hm-tc"></span></div>`).join("")}</div>
      </div>` : ""}
      ${landmarks.length ? `
      <div class="hm-divider"></div>
      <div class="hm-section">
        <div class="hm-section-label">Nearby landmarks</div>
        <p class="hm-landmarks-text"></p>
      </div>` : ""}
      ${h.ai_summary ? `
      <div class="hm-divider"></div>
      <div class="hm-section">
        <div class="ai-summary-block">
          <div class="ai-summary-label">${SPARKLE_ICON}<span>AI Summary</span></div>
          <p class="ai-summary-text hm-summary-text"></p>
        </div>
      </div>` : ""}
      ${images.length ? `
      <div class="hm-divider"></div>
      <div class="hm-section">
        <div class="hm-section-label">Photos</div>
        <div class="hm-images">${images.map(() => `<img class="hm-image" alt="" loading="lazy">`).join("")}</div>
      </div>` : ""}
      ${h.hotel_url ? `
      <div class="hm-divider"></div>
      <a class="hm-link" target="_blank" rel="noopener noreferrer">Visit Hotel Website ${EXT_ICON}</a>` : ""}
    </div>
  `;

  modal.querySelector(".hm-title").textContent = h.hotel_name;
  const cityParts = [h.city, h.country].filter(Boolean);
  modal.querySelector(".hm-city").textContent = cityParts.length ? cityParts.join(", ") : (h.location || "");
  modal.querySelector(".hm-reviews").textContent = fmtReviews(h.rating_count);
  modal.querySelectorAll(".hm-fc").forEach((el, i) => el.textContent = facilities[i]);
  modal.querySelectorAll(".hm-tc").forEach((el, i) => el.textContent = transit[i]);
  if (landmarks.length) modal.querySelector(".hm-landmarks-text").textContent = landmarks.join(" · ");
  if (h.ai_summary)     modal.querySelector(".hm-summary-text").textContent = h.ai_summary;
  if (images.length)    modal.querySelectorAll(".hm-image").forEach((el, i) => { el.src = images[i]; el.alt = `${h.hotel_name} photo ${i + 1}`; });
  if (h.hotel_url)      modal.querySelector(".hm-link").href = safeUrl(h.hotel_url);
  modal.querySelector(".hotel-modal-close").addEventListener("click", closeHotelModal);

  modal.scrollTop = 0;
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeHotelModal() {
  if (!_hotelModalEl) return;
  _hotelModalEl.classList.remove("open");
  document.body.style.overflow = "";
}

// ═══════════════════════════════════════════════════════════════
//  Send — endpoint, headers, request/response contract UNCHANGED
// ═══════════════════════════════════════════════════════════════
async function sendMessage(presetText) {
  const text = (typeof presetText === "string" ? presetText : messageInput.value).trim();
  if (!text) return;

  if (currentChatId === null) {
    hideEmptyState();
    const chat = {
      id:        createChatId(),
      title:     text,
      messages:  [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    currentChatId   = chat.id;
    currentMessages = [];
    addChat(chat);
    renderSidebar();
  }

  const userMsg = { role: "user", type: "text", content: text };
  currentMessages.push(userMsg);
  updateChat(currentChatId, currentMessages);
  renderTextMessage(text, "user");

  messageInput.value        = "";
  messageInput.style.height = "auto";
  sendButton.disabled       = true;

  const searchingEl = renderSearchingCard(text);

  try {
    const response = await fetch("/api/chat", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ message: text }),
    });

    if (searchingEl._clearTimer) searchingEl._clearTimer();
    searchingEl.remove();
    const data = await response.json();

    if (!response.ok) {
      const msg = { role: "assistant", type: "text", content: "Something went wrong. Please try again." };
      currentMessages.push(msg);
      updateChat(currentChatId, currentMessages);
      renderErrorMessage(msg.content, () => sendMessage(text));
      return;
    }

    if (!data.results || data.results.length === 0) {
      const replyText = data.reply ?? "No results found.";
      const msg = { role: "assistant", type: "text", content: replyText };
      currentMessages.push(msg);
      updateChat(currentChatId, currentMessages);
      renderTextMessage(replyText, "bot");
      return;
    }

    const msg = { role: "assistant", type: "results", reply: data.reply, results: data.results };
    currentMessages.push(msg);
    updateChat(currentChatId, currentMessages);
    renderHotelList(data.reply, data.results);

    renderSidebar();

  } catch {
    if (searchingEl._clearTimer) searchingEl._clearTimer();
    searchingEl.remove();
    const msg = { role: "assistant", type: "text", content: "Network error — please check your connection and try again." };
    currentMessages.push(msg);
    updateChat(currentChatId, currentMessages);
    renderErrorMessage(msg.content, () => sendMessage(text));
  } finally {
    sendButton.disabled = false;
  }
}

sendButton.addEventListener("click", () => sendMessage());

messageInput.addEventListener("keydown", event => {
  const meta = event.metaKey || event.ctrlKey;
  if (event.key === "Enter" && (!event.shiftKey || meta)) {
    event.preventDefault();
    sendMessage();
  }
});

// ═══════════════════════════════════════════════════════════════
//  Init
// ═══════════════════════════════════════════════════════════════
renderSidebar();
