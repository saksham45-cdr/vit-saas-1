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

  const list = document.createElement("div");
  list.className = "hotel-list";

  results.forEach(hotel => {
    const card = document.createElement("div");
    card.className = "hotel-card";

    const name = document.createElement("div");
    name.className = "hotel-name";
    name.textContent = hotel.hotel_name;
    card.appendChild(name);

    const location = document.createElement("div");
    location.className = "hotel-location";
    location.textContent = hotel.location;
    card.appendChild(location);

    if (hotel.rating !== null) {
      const rating = document.createElement("div");
      rating.className = "hotel-rating";
      const reviewText = hotel.rating_count !== null ? ` (${hotel.rating_count} reviews)` : "";
      rating.textContent = `Rating: ${hotel.rating}${reviewText}`;
      card.appendChild(rating);
    }

    if (hotel.number_of_rooms !== null) {
      const rooms = document.createElement("div");
      rooms.className = "hotel-rooms";
      rooms.textContent = `Rooms: ${hotel.number_of_rooms}`;
      card.appendChild(rooms);
    }

    const tags = [];
    if (hotel.family_rooms) tags.push("Family rooms");
    if (hotel.connected_rooms) tags.push("Connected rooms");
    if (tags.length > 0) {
      const tagEl = document.createElement("div");
      tagEl.className = "hotel-tags";
      tagEl.textContent = tags.join(" · ");
      card.appendChild(tagEl);
    }

    if (hotel.ai_summary) {
      const summary = document.createElement("div");
      summary.className = "hotel-summary";
      summary.textContent = hotel.ai_summary;
      card.appendChild(summary);
    }

    const sourceEl = document.createElement("div");
    sourceEl.className = "source-indicator";
    sourceEl.textContent = hotel.source === "cache" ? "Cached" : "Freshly fetched";
    card.appendChild(sourceEl);

    list.appendChild(card);
  });

  wrapper.appendChild(list);
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
