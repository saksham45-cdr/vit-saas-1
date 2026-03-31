// ─── DOM refs ───────────────────────────────────────────────────────────────
const chatContainer  = document.getElementById("chat-container");
const messageInput   = document.getElementById("message-input");
const sendButton     = document.getElementById("send-button");
const emptyState     = document.getElementById("empty-state");
const sidebar        = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");
const menuBtn        = document.getElementById("menu-btn");
const newChatBtn     = document.getElementById("new-chat-btn");
const chatHistory    = document.getElementById("chat-history");

// ─── Sidebar ─────────────────────────────────────────────────────────────────
menuBtn.addEventListener("click", () => {
  sidebar.classList.add("open");
  sidebarOverlay.classList.add("open");
});

sidebarOverlay.addEventListener("click", () => {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("open");
});

// ─── New search ───────────────────────────────────────────────────────────────
newChatBtn.addEventListener("click", () => {
  // Remove all messages
  [...chatContainer.children].forEach(el => {
    if (el.id !== "empty-state") el.remove();
  });

  // Restore empty state
  if (!document.getElementById("empty-state")) {
    const es = emptyStateTemplate();
    chatContainer.appendChild(es);
    bindSuggestionChips(es);
  }

  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("open");
  messageInput.focus();
});

// ─── Recent searches sidebar ─────────────────────────────────────────────────
function addHistoryItem(text) {
  const placeholder = chatHistory.querySelector(".history-empty");
  if (placeholder) placeholder.remove();

  const item = document.createElement("div");
  item.className = "history-item";
  item.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
    <span>${text.length > 34 ? text.slice(0, 34) + "…" : text}</span>
  `;
  chatHistory.prepend(item);

  // Cap at 8 entries
  const items = chatHistory.querySelectorAll(".history-item");
  if (items.length > 8) items[items.length - 1].remove();
}

// ─── Empty state ─────────────────────────────────────────────────────────────
function hideEmptyState() {
  const es = document.getElementById("empty-state");
  if (!es) return;
  es.style.transition = "opacity 180ms ease, transform 180ms ease";
  es.style.opacity = "0";
  es.style.transform = "translateY(-8px)";
  setTimeout(() => es.remove(), 200);
}

function emptyStateTemplate() {
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
  return div;
}

// ─── Suggestion chips ────────────────────────────────────────────────────────
function bindSuggestionChips(container) {
  container.querySelectorAll(".suggestion-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      messageInput.value = chip.textContent.trim();
      messageInput.dispatchEvent(new Event("input"));
      messageInput.focus();
    });
  });
}

// Bind chips in the initial HTML-rendered empty state
if (emptyState) bindSuggestionChips(emptyState);

// ─── Auto-resize textarea ─────────────────────────────────────────────────────
messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 140) + "px";
});

// ─── Message helpers ──────────────────────────────────────────────────────────
function appendMessage(text, role) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  wrapper.appendChild(bubble);

  chatContainer.appendChild(wrapper);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return wrapper;
}

function appendHotelList(reply, results) {
  const wrapper = document.createElement("div");
  wrapper.className = "message bot";

  const summary = document.createElement("div");
  summary.className = "reply-summary";
  summary.textContent = reply;
  wrapper.appendChild(summary);

  if (results.length === 0) {
    chatContainer.appendChild(wrapper);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return;
  }

  const tableWrap = document.createElement("div");
  tableWrap.className = "hotel-table-wrap";

  const table = document.createElement("table");
  table.className = "hotel-table";

  // Header
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const columns = [
    "Hotel Name", "City", "Rating", "Reviews",
    "Rooms", "Family Rooms", "Connected Rooms",
    "Facilities", "Nearby Transit", "Summary"
  ];
  columns.forEach(col => {
    const th = document.createElement("th");
    th.textContent = col;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
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
      Array.isArray(hotel.facilities) && hotel.facilities.length > 0
        ? hotel.facilities.join(", ")
        : "—",
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

// ─── Send ─────────────────────────────────────────────────────────────────────
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;

  hideEmptyState();
  addHistoryItem(text);

  appendMessage(text, "user");
  messageInput.value = "";
  messageInput.style.height = "auto";
  sendButton.disabled = true;

  const searchingEl = appendMessage("Searching…", "bot searching");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text })
    });

    searchingEl.remove();

    const data = await response.json();

    if (!response.ok) {
      appendMessage("Something went wrong. Please try again.", "bot");
      return;
    }

    if (!data.results || data.results.length === 0) {
      appendMessage(data.reply ?? "No results found.", "bot");
      return;
    }

    appendHotelList(data.reply, data.results);
  } catch {
    searchingEl.remove();
    appendMessage("Network error — please check your connection and try again.", "bot");
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
