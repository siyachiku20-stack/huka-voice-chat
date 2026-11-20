"use strict";

/* =========================================
   HUKA VOICE CHAT - ROOM JAVASCRIPT
========================================= */

const socket = io();

const params = new URLSearchParams(location.search);

const ROOM_ID =
  params.get("room") ||
  params.get("roomId") ||
  localStorage.getItem("hukaRoomId") ||
  "";

const USER_ID = localStorage.getItem("hukaUserId") || "";

const USER_NAME =
  localStorage.getItem("hukaName") ||
  localStorage.getItem("hukaUsername") ||
  "Guest";

let currentRoom = null;
let roomMembers = [];
let currentSeats = {};
let currentSeatCount = 9;
let selectedGift = null;
let selectedGiftPrice = 0;
let isMicOn = false;
let isSpeakerOn = true;
let isAdmin = false;
let myCoins = 0;

const $ = (id) => document.getElementById(id);

function showMessage(message) {
  alert(message);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function safeImage(value) {
  if (typeof value !== "string") return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(value)) {
    return value;
  }
  return "";
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value ?? "";
}

function emitWithAck(eventName, data = {}) {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(eventName, data, (error, response) => {
      if (error) {
        resolve({ ok: false, message: "Server response timeout" });
      } else {
        resolve(response || { ok: true });
      }
    });
  });
}

/* =========================================
   CONNECTION
========================================= */

socket.on("connect", () => {
  setText("connectionStatus", "Connected");

  if (!USER_ID) {
    showMessage("User ID nahi mila. Pehle profile se login karein.");
    return;
  }

  if (!ROOM_ID) {
    showMessage("Room ID nahi mili.");
    return;
  }

  socket.emit("register", {
    userId: USER_ID,
    name: USER_NAME
  }, (response) => {
    if (!response || !response.ok) {
      showMessage(response?.message || "Registration failed");
      return;
    }

    if (response.user) {
      myCoins = Number(response.user.coins || 0);
      setText("coinBalance", myCoins);
    }

    joinRoom();
  });
});

socket.on("disconnect", () => {
  setText("connectionStatus", "Disconnected");
});

socket.on("connect_error", () => {
  setText("connectionStatus", "Connection error");
});

/* =========================================
   JOIN ROOM
========================================= */

function joinRoom() {
  socket.emit("join-room", {
    roomId: ROOM_ID
  }, (response) => {
    if (response && response.ok === false) {
      showMessage(response.message || "Room join nahi hua");
      return;
    }

    setText("roomId", ROOM_ID);
    setText("roomStatus", "Online");
  });
}

/* =========================================
   ROOM MEMBERS
========================================= */

socket.on("members-update", (data) => {
  if (Array.isArray(data)) {
    roomMembers = data;
  } else if (data && Array.isArray(data.members)) {
    roomMembers = data.members;
    currentRoom = data;
    currentSeats = data.seats || {};
  } else {
    return;
  }

  renderMembers();
  renderSeats();
  updateGiftReceivers();
});

socket.on("room-update", (room) => {
  if (!room) return;

  currentRoom = room;
  currentSeats = room.seats || currentSeats;

  setText("roomName", room.name || "Huka Voice Room");
  setText("roomTitle", room.name || "Huka Voice Room");
  setText("roomOwner", room.ownerName || room.owner || "Room Owner");
  setText("roomDescription", room.description || "");

  renderSeats();
});

function renderMembers() {
  const container = $("members");
  if (!container) return;

  container.innerHTML = "";

  setText("memberCount", roomMembers.length);
  setText("memberCountText", roomMembers.length + " Online");

  roomMembers.forEach((member) => {
    const name = typeof member === "string"
      ? member
      : member.name || member.username || "Guest";

    const item = document.createElement("div");
    item.className = "member-item";

    const avatar = safeImage(member.avatar);

    item.innerHTML = `
      <img src="${avatar || "https://placehold.co/80x80/49305f/ffffff?text=H"}"
           alt="Avatar">
      <div class="member-name">${escapeHTML(name)}</div>
      <span class="member-status">Online</span>
    `;

    container.appendChild(item);
  });

  if (!roomMembers.length) {
    container.innerHTML = '<p class="empty-seat">No members yet</p>';
  }
}

function renderSeats() {
  const container = $("seats");
  if (!container) return;

  container.innerHTML = "";

  const seatEntries = Object.entries(currentSeats || {});

  for (let i = 1; i <= currentSeatCount; i++) {
    const occupant = currentSeats[i] || currentSeats[String(i)];

    const seat = document.createElement("div");
    seat.className = "seat";

    if (occupant) {
      const name = typeof occupant === "string"
        ? occupant
        : occupant.name || occupant.username || "Member";

      seat.innerHTML = `
        <div class="seat-number">Seat ${i}</div>
        <div class="seat-avatar">🎙️</div>
        <div class="seat-name">${escapeHTML(name)}</div>
      `;
    } else {
      seat.innerHTML = `
        <div class="seat-number">Seat ${i}</div>
        <div class="seat-avatar">＋</div>
        <div class="empty-seat">Empty</div>
      `;
    }

    seat.addEventListener("click", () => {
      if (!occupant) takeSeat(i);
      else showMessage("This seat is already occupied.");
    });

    container.appendChild(seat);
  }
}

/* =========================================
   SEAT MANAGEMENT
========================================= */

async function takeSeat(seatNumber) {
  const response = await emitWithAck("take-seat", {
    roomId: ROOM_ID,
    seat: seatNumber
  });

  if (response.ok === false) {
    showMessage(response.message || "Seat nahi mil saki");
  }
}

async function leaveSeat() {
  const response = await emitWithAck("leave-seat", {
    roomId: ROOM_ID
  });

  if (response.ok === false) {
    showMessage(response.message || "Seat leave nahi hui");
  }
}

document.querySelectorAll("[data-seats]").forEach((button) => {
  button.addEventListener("click", async () => {
    const count = Number(button.dataset.seats);

    if (![9, 11, 15, 20].includes(count)) return;

    const response = await emitWithAck("update-room-settings", {
      roomId: ROOM_ID,
      seats: count
    });

    if (response.ok === false) {
      showMessage(response.message || "Seat settings update nahi hui");
      return;
    }

    currentSeatCount = count;

    document.querySelectorAll("[data-seats]").forEach((item) => {
      item.classList.toggle(item === button ? "active" : "inactive", item === button);
    });

    renderSeats();
  });
});

/* =========================================
   CHAT
========================================= */

function addChatMessage(username, message) {
  const container = $("chatMessages");
  if (!container) return;

  const item = document.createElement("div");
  item.className = "chat-message";

  const name = document.createElement("span");
  name.className = "username";
  name.textContent = username;

  const text = document.createElement("span");
  text.textContent = message;

  item.appendChild(name);
  item.appendChild(text);

  container.appendChild(item);
  container.scrollTop = container.scrollHeight;
}

function sendChatMessage() {
  const input = $("chatInput");
  if (!input) return;

  const message = input.value.trim();
  if (!message) return;

  socket.emit("room-message", {
    roomId: ROOM_ID,
    message
  }, (response) => {
    if (response && response.ok === false) {
      showMessage(response.message || "Message send nahi hua");
    }
  });

  input.value = "";
}

$("sendMessage")?.addEventListener("click", sendChatMessage);

$("chatInput")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") sendChatMessage();
});

socket.on("room-message", (data) => {
  if (!data) return;

  addChatMessage(
    data.username || data.name || "Guest",
    data.message || ""
  );
});

/* =========================================
   CLEAR CHAT
========================================= */

$("clearChatButton")?.addEventListener("click", () => {
  if (!confirm("Clear room chat?")) return;

  socket.emit("clear-chat", {
    roomId: ROOM_ID
  });
});

socket.on("chat-cleared", () => {
  const container = $("chatMessages");
  if (container) container.innerHTML = "";
});

/* =========================================
   EMOJI
========================================= */

function openEmoji() {
  if ($("emojiModal")) $("emojiModal").style.display = "flex";
}

function closeEmoji() {
  if ($("emojiModal")) $("emojiModal").style.display = "none";
}

$("emojiButton")?.addEventListener("click", openEmoji);
$("closeEmoji")?.addEventListener("click", closeEmoji);

$("emojiList")?.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  socket.emit("send-emoji", {
    roomId: ROOM_ID,
    emoji: button.textContent
  });

  closeEmoji();
});

socket.on("emoji-event", (data) => {
  if (!data) return;

  addChatMessage(
    data.username || "Guest",
    data.emoji || "😊"
  );
});

/* =========================================
   MIC BUTTON
========================================= */

function toggleMic() {
  isMicOn = !isMicOn;

  const buttons = [$("micButton"), $("bottomMicButton"), $("micBtn")];

  buttons.forEach((button) => {
    if (button) {
      button.textContent = isMicOn ? "🎙️" : "🔇";
      button.classList.toggle("active", isMicOn);
    }
  });

  socket.emit("mic-state", {
    roomId: ROOM_ID,
    muted: !isMicOn
  });

  if (isMicOn) {
    showMessage("Mic state ON. Voice calling ke liye WebRTC setup zaroori hai.");
  }
}

$("micButton")?.addEventListener("click", toggleMic);
$("bottomMicButton")?.addEventListener("click", toggleMic);
$("micBtn")?.addEventListener("click", toggleMic);

/* =========================================
   SPEAKER BUTTON
========================================= */

function toggleSpeaker() {
  isSpeakerOn = !isSpeakerOn;

  const button = $("speakerButton") || $("speakerBtn");

  if (button) {
    button.textContent = isSpeakerOn ? "🔊" : "🔇";
    button.classList.toggle("active", isSpeakerOn);
  }
}

$("speakerButton")?.addEventListener("click", toggleSpeaker);
$("speakerBtn")?.addEventListener("click", toggleSpeaker);

/* =========================================
   GIFT SYSTEM
========================================= */

function openGift() {
  if ($("giftModal")) $("giftModal").style.display = "flex";

  socket.emit("get-gifts");
}

function closeGift() {
  if ($("giftModal")) $("giftModal").style.display = "none";
}

$("giftButton")?.addEventListener("click", openGift);
$("closeGift")?.addEventListener("click", closeGift);

socket.on("gift-list", (gifts) => {
  const container = $("giftList");
  if (!container || !Array.isArray(gifts)) return;

  container.innerHTML = "";

  gifts.forEach((gift) => {
    const item = document.createElement("div");
    item.className = "gift-item";

    const icon = gift.icon || gift.emoji || "🎁";
    const name = gift.name || "Gift";
    const price = Number(gift.price || gift.coins || 0);

    item.innerHTML = `
      <div class="gift-icon">${escapeHTML(icon)}</div>
      <div class="gift-name">${escapeHTML(name)}</div>
      <div class="gift-price">🪙 ${price}</div>
      <button type="button">Send</button>
    `;

    item.querySelector("button").addEventListener("click", () => {
      selectedGift = gift;
      selectedGiftPrice = price;
      sendGift();
    });

    container.appendChild(item);
  });
});

function updateGiftReceivers() {
  const select = $("giftReceiver");
  if (!select) return;

  const oldValue = select.value;
  select.innerHTML = '<option value="">Select member</option>';

  roomMembers.forEach((member) => {
    if (typeof member === "string") return;

    const id = member.userId || member.id;
    const name = member.name || member.username || "Member";

    if (!id || id === USER_ID) return;

    const option = document.createElement("option");
    option.value = id;
    option.textContent = name;
    select.appendChild(option);
  });

  if (oldValue) select.value = oldValue;
}

async function sendGift() {
  if (!selectedGift) return;

  const receiver = $("giftReceiver")?.value;

  if (!receiver) {
    showMessage("Pehle gift receiver select karein.");
    return;
  }

  if (myCoins < selectedGiftPrice) {
    showMessage("Aapke paas enough coins nahi hain.");
    return;
  }

  const response = await emitWithAck("send-gift", {
    roomId: ROOM_ID,
    receiverId: receiver,
    giftId: selectedGift.id,
    quantity: 1
  });

  if (response.ok === false) {
    showMessage(response.message || "Gift send nahi hua");
    return;
  }

  if (response.coins !== undefined) {
    myCoins = Number(response.coins);
    setText("coinBalance", myCoins);
  }

  closeGift();
}

socket.on("gift-event", (data) => {
  if (!data) return;

  addChatMessage(
    "🎁 " + (data.senderName || data.username || "Member"),
    "sent a gift: " + (data.giftName || "Gift")
  );
});

/* =========================================
   GIFT RANKING
========================================= */

socket.on("gift-ranking", (ranking) => {
  const container = $("giftRanking");
  if (!container || !Array.isArray(ranking)) return;

  container.innerHTML = "";

  ranking.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "ranking-item";

    row.textContent =
      `${index + 1}. ${item.name || "Member"} — ${item.coins || 0} coins`;

    container.appendChild(row);
  });
});

/* =========================================
   INBOX
========================================= */

function openInbox() {
  if ($("inboxModal")) $("inboxModal").style.display = "flex";

  socket.emit("get-inbox");
}

function closeInbox() {
  if ($("inboxModal")) $("inboxModal").style.display = "none";
}

$("inboxButton")?.addEventListener("click", openInbox);
$("inboxBottomButton")?.addEventListener("click", openInbox);
$("closeInbox")?.addEventListener("click", closeInbox);

socket.on("inbox-messages", (messages) => {
  const container = $("inboxMessages");
  if (!container) return;

  container.innerHTML = "";

  if (!Array.isArray(messages) || !messages.length) {
    container.textContent = "No messages";
    return;
  }

  messages.forEach((message) => {
    const item = document.createElement("div");
    item.className = "inbox-message";
    item.textContent =
      `${message.fromName || "Member"}: ${message.message || ""}`;

    container.appendChild(item);
  });
});

/* =========================================
   YOUTUBE LINK SHARING
========================================= */

$("youtubeButton")?.addEventListener("click", () => {
  $("youtubeInput")?.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  $("youtubeInput")?.focus();
});

$("shareYoutubeButton")?.addEventListener("click", () => {
  const input = $("youtubeInput");
  if (!input) return;

  const link = input.value.trim();

  let url;

  try {
    url = new URL(link);
  } catch {
    showMessage("Valid YouTube link enter karein.");
    return;
  }

  const allowed =
    url.hostname === "youtube.com" ||
    url.hostname === "www.youtube.com" ||
    url.hostname === "youtu.be" ||
    url.hostname === "m.youtube.com";

  if (!allowed) {
    showMessage("Sirf YouTube link share karein.");
    return;
  }

  socket.emit("share-youtube", {
    roomId: ROOM_ID,
    url: url.href
  });

  input.value = "";
});

socket.on("youtube-shared", (data) => {
  if (!data || !data.url) return;

  const container = $("youtubeLinks");
  if (!container) return;

  const link = document.createElement("a");
  link.href = data.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "▶️ Open YouTube Link";

  const row = document.createElement("p");
  row.appendChild(link);
  container.appendChild(row);
});

/* =========================================
   ROOM SETTINGS
========================================= */

$("saveRoomSettings")?.addEventListener("click", () => {
  const name = $("settingRoomName")?.value.trim();
  const description = $("settingDescription")?.value.trim();

  const locked = Boolean($("roomLocked")?.checked);
  const youtubeAllowed = Boolean($("youtubeAllowed")?.checked);

  socket.emit("update-room-settings", {
    roomId: ROOM_ID,
    name,
    description,
    locked,
    youtubeAllowed
  }, (response) => {
    if (response && response.ok === false) {
      showMessage(response.message || "Settings save nahi hui");
      return;
    }

    showMessage("Room settings update request sent.");
  });
});

/* =========================================
   ADMIN BUTTONS
========================================= */

$("addAdminButton")?.addEventListener("click", () => {
  const userId = $("adminUserId")?.value.trim();
  if (!userId) return showMessage("User ID enter karein.");

  socket.emit("add-room-admin", {
    roomId: ROOM_ID,
    userId
  });
});

$("removeAdminButton")?.addEventListener("click", () => {
  const userId = $("adminUserId")?.value.trim();
  if (!userId) return showMessage("User ID enter karein.");

  socket.emit("remove-room-admin", {
    roomId: ROOM_ID,
    userId
  });
});

$("kickMemberButton")?.addEventListener("click", () => {
  const userId = $("adminUserId")?.value.trim();
  if (!userId) return showMessage("User ID enter karein.");

  socket.emit("kick-member", {
    roomId: ROOM_ID,
    userId
  });
});

$("forceMuteButton")?.addEventListener("click", () => {
  const userId = $("adminUserId")?.value.trim();
  if (!userId) return showMessage("User ID enter karein.");

  socket.emit("force-mute", {
    roomId: ROOM_ID,
    userId
  });
});

socket.on("admin-status", (data) => {
  isAdmin = Boolean(data && data.isAdmin);

  if ($("adminPanel")) {
    $("adminPanel").style.display = isAdmin ? "block" : "none";
  }
});

/* =========================================
   LEAVE ROOM
========================================= */

async function leaveRoom() {
  if (!confirm("Kya aap room se bahar jana chahte hain?")) return;

  socket.emit("leave-room", {
    roomId: ROOM_ID
  }, () => {
    location.href = "index.html";
  });

  setTimeout(() => {
    location.href = "index.html";
  }, 1500);
}

$("leaveRoom")?.addEventListener("click", leaveRoom);

/* =========================================
   INITIAL PAGE SETUP
========================================= */

setText("roomId", ROOM_ID);
setText("roomName", "Huka Voice Room");
setText("roomTitle", "🎙️ Huka Voice Room");

if (!ROOM_ID) {
  setText("roomStatus", "Room ID missing");
}

console.log("Huka Voice Chat Room JS Loaded");
