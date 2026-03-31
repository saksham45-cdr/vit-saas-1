const chatContainer = document.getElementById("chat-container");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");

function appendMessage(text, role) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;

  const content = document.createElement("div");
  content.textContent = text;
  wrapper.appendChild(content);

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

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;

  appendMessage(text, "user");
  messageInput.value = "";
  sendButton.disabled = true;

  // Show "Searching..." indicator immediately
  const searchingEl = appendMessage("Searching...", "bot searching");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text })
    });

    // Remove the searching indicator
    searchingEl.remove();

    const data = await response.json();

    if (!response.ok) {
      appendMessage("Something went wrong. Please try again.", "bot");
      return;
    }

    // Server returned a user-facing message with no results (not-found, bad query, etc.)
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
