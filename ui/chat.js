// ═══════════════════════════════════════════════════════════════
//  Storage layer
//  key: "hiq_chats"  →  Chat[]
//  Chat { id, title, messages, createdAt, updatedAt }
//  Message { role, type, content?, reply?, results? }
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
//  Session state
// ═══════════════════════════════════════════════════════════════
let currentChatId  = null;
let currentMessages = [];   // in-memory mirror of active chat's messages[]

// ═══════════════════════════════════════════════════════════════
//  DOM refs
// ═══════════════════════════════════════════════════════════════
const chatContainer  = document.getElementById("chat-container");
const messageInput   = document.getElementById("message-input");
const sendButton     = document.getElementById("send-button");
const sidebar        = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");
const menuBtn        = document.getElementById("menu-btn");
const newChatBtn     = document.getElementById("new-chat-btn");
const chatHistory    = document.getElementById("chat-history");

// ═══════════════════════════════════════════════════════════════
//  Sidebar open / close
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

  // Update active highlight without full re-render
  chatHistory.querySelectorAll(".history-item").forEach(el => {
    el.classList.toggle("active", el.dataset.chatId === id);
  });

  // Clear UI and replay all stored messages (no entry animation)
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
  renderSidebar();   // deselect active item
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
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9,22 9,12 15,12 15,22"/>
      </svg>
    </div>
    <h2 class="empty-title">Hotel Research Assistant</h2>
    <p class="empty-desc">Get enriched data on any hotel — ratings, room types, facilities, nearby transit, and AI-powered summaries.</p>
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

// Bind chips on the initial HTML-rendered empty state
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
//  Unified message renderer
//  animate=false when replaying history (no fade-in cascade)
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

function renderHotelList(reply, results, animate = true) {
  const wrapper = document.createElement("div");
  wrapper.className = "message bot";
  if (!animate) wrapper.style.animation = "none";

  const summary = document.createElement("div");
  summary.className = "reply-summary";
  summary.textContent = reply;
  wrapper.appendChild(summary);

  if (!results || results.length === 0) {
    chatContainer.appendChild(wrapper);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return;
  }

  const tableWrap = document.createElement("div");
  tableWrap.className = "hotel-table-wrap";

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
  results.forEach(hotel => {
    const tr = document.createElement("tr");
    const cells = [
      hotel.hotel_name,
      hotel.city || hotel.location || "—",
      hotel.rating !== null ? String(hotel.rating) : "—",
      hotel.rating_count !== null ? hotel.rating_count.toLocaleString() : "—",
      hotel.number_of_rooms !== null ? String(hotel.number_of_rooms) : "—",
      hotel.family_rooms ? "Yes" : hotel.family_rooms === false ? "No" : "—",
      hotel.connected_rooms ? "Yes" : hotel.connected_rooms === false ? "No" : "—",
      Array.isArray(hotel.facilities) && hotel.facilities.length > 0 ? hotel.facilities.join(", ") : "—",
      hotel.nearby_transit || "—",
      hotel.ai_summary || "—",
    ];
    cells.forEach((val, i) => {
      const td = document.createElement("td");
      td.textContent = val;
      if (i === 7) td.className = "facilities-cell";
      if (i === 8) td.className = "transit-cell";
      if (i === 9) td.className = "summary-cell";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  tableWrap.appendChild(table);
  wrapper.appendChild(tableWrap);
  chatContainer.appendChild(wrapper);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ═══════════════════════════════════════════════════════════════
//  Send
// ═══════════════════════════════════════════════════════════════
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;

  // First message of a new chat — create and persist the chat object
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

  // Store and render user turn
  const userMsg = { role: "user", type: "text", content: text };
  currentMessages.push(userMsg);
  updateChat(currentChatId, currentMessages);
  renderTextMessage(text, "user");

  messageInput.value        = "";
  messageInput.style.height = "auto";
  sendButton.disabled       = true;

  const searchingEl = renderTextMessage("Searching…", "bot searching");

  try {
    const response = await fetch("/api/chat", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ message: text }),
    });

    searchingEl.remove();
    const data = await response.json();

    if (!response.ok) {
      const msg = { role: "assistant", type: "text", content: "Something went wrong. Please try again." };
      currentMessages.push(msg);
      updateChat(currentChatId, currentMessages);
      renderTextMessage(msg.content, "bot");
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

    // Hotel results — store full data so we can re-render on history load
    const msg = { role: "assistant", type: "results", reply: data.reply, results: data.results };
    currentMessages.push(msg);
    updateChat(currentChatId, currentMessages);
    renderHotelList(data.reply, data.results);

    // Bubble the chat to top of sidebar (updatedAt changed)
    renderSidebar();

  } catch {
    searchingEl.remove();
    const msg = { role: "assistant", type: "text", content: "Network error — please check your connection and try again." };
    currentMessages.push(msg);
    updateChat(currentChatId, currentMessages);
    renderTextMessage(msg.content, "bot");
  } finally {
    sendButton.disabled = false;
  }
}

sendButton.addEventListener("click", sendMessage);

messageInput.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

// ═══════════════════════════════════════════════════════════════
//  Init — render sidebar from persisted storage on page load
// ═══════════════════════════════════════════════════════════════
renderSidebar();
