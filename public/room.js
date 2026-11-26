/* ==========================================
   HUKA VOICE CHAT - ROOM JAVASCRIPT
   Galaxy Room + Live Chat + Gifts + Seats
   Socket.IO + WebRTC Voice
========================================== */

const socket = io();

const $ = id => document.getElementById(id);

const params = new URLSearchParams(location.search);

const roomId =
  params.get("room") ||
  params.get("roomId") ||
  localStorage.getItem("hukaRoomId") ||
  "";

let userId =
  localStorage.getItem("hukaUserId") ||
  localStorage.getItem("hukaProfileId") ||
  "";

let username =
  localStorage.getItem("hukaName") ||
  localStorage.getItem("hukaUsername") ||
  "Huka User";

let currentRoom = null;
let currentMembers = [];
let currentSeats = [];
let currentSettings = {};
let currentCoins = 0;

let selectedGift = "";
let selectedTab = "all";

let micStream = null;
let micEnabled = false;
let speakerEnabled = true;

let giftPrices = {};

const peerConnections = new Map();
const remoteAudioElements = new Map();

let toastTimer;
let notificationTimer;

/* ==========================================
   HELPERS
========================================== */

function toast(message) {
  const box = $("toast");

  if (!box) {
    alert(message);
    return;
  }

  box.textContent = message;
  box.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    box.classList.remove("show");
  }, 2500);
}

function showModal(id) {
  const modal = $(id);

  if (modal) {
    modal.classList.remove("hidden");
  }
}

function hideModal(id) {
  const modal = $(id);

  if (modal) {
    modal.classList.add("hidden");
  }
}

function emitWithReply(eventName, data = {}) {
  return new Promise(resolve => {
    socket.emit(eventName, data, response => {
      resolve(response || {
        ok: false,
        error: "Server response nahi mila."
      });
    });
  });
}

function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]
  );
}

function getTime(time) {
  return new Date(time || Date.now())
    .toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
}

/* ==========================================
   REGISTER USER
========================================== */

function registerUser() {
  socket.emit("register", {
    name: username,
    profileId: userId
  }, response => {

    if (!response || !response.ok) {
      toast(response?.error || "Registration failed.");
      return;
    }

    const user = response.user;

    userId = user.id;
    username = user.name;

    currentCoins = Number(user.coins || 0);

    localStorage.setItem("hukaUserId", user.id);
    localStorage.setItem("hukaProfileId", user.id);
    localStorage.setItem("hukaName", user.name);
    localStorage.setItem("hukaUsername", user.name);

    updateCoins();

    joinRoom();
  });
}

/* ==========================================
   JOIN ROOM
========================================== */

function joinRoom() {
  if (!roomId) {
    toast("Room ID missing.");

    setTimeout(() => {
      location.href = "index.html";
    }, 1500);

    return;
  }

  localStorage.setItem("hukaRoomId", roomId);

  socket.emit("join-room", {
    roomId: roomId
  }, response => {

    if (!response || !response.ok) {
      toast(response?.error || "Room join nahi hua.");

      setTimeout(() => {
        location.href = "index.html";
      }, 2000);

      return;
    }

    currentRoom = response.room;

    currentSeats = response.seats || [];
    currentMembers = response.members || [];
    currentSettings = response.settings || {};

    $("roomName").textContent =
      currentRoom.name || "Huka Room";

    $("roomId").textContent = currentRoom.id;

    $("roomStatus").textContent = "🟢 Connected";

    renderSeats();
    renderMembers();
    renderChatHistory(response.messages || []);

    updateRoomSettings(currentSettings);

    // Server mic state ko initially off rakho.
    socket.emit("mic-state", {
      micOn: false
    });

    micEnabled = false;
    updateMicButton();

    loadGifts();
    loadInbox();

    toast("Welcome to Huka Room!");
  });
}

/* ==========================================
   ROOM DETAILS
========================================== */

function updateRoomSettings(settings) {
  currentSettings = {
    ...currentSettings,
    ...settings
  };

  if (settings.name) {
    $("roomName").textContent = settings.name;
  }

  if ($("roomDescription")) {
    $("roomDescription").textContent =
      settings.description || "Welcome to Huka Lounge";
  }

  if ($("settingRoomName")) {
    $("settingRoomName").value =
      settings.name || currentRoom?.name || "";
  }

  if ($("settingDescription")) {
    $("settingDescription").value =
      settings.description || "";
  }

  if ($("settingLocked")) {
    $("settingLocked").checked =
      Boolean(settings.locked);
  }

  if ($("settingYoutube")) {
    $("settingYoutube").checked =
      settings.allowYoutube !== false;
  }
}

/* ==========================================
   SEAT RENDERING WITH PROFILE FRAMES
========================================== */

function renderSeats() {
  const vipContainer = $("vipSeats");
  const normalContainer = $("normalSeats");

  if (!vipContainer || !normalContainer) return;

  vipContainer.innerHTML = "";
  normalContainer.innerHTML = "";

  const count = currentSeats.length || 9;

  for (let i = 0; i < count; i++) {
    const seat = currentSeats[i];

    const member = seat
      ? currentMembers.find(
          item => item.socketId === seat.socketId
        )
      : null;

    const card = document.createElement("div");

    card.className =
      "seat-card " +
      (seat ? "occupied" : "empty-seat") +
      (i === 0 ? " host" : "") +
      (i < 5 ? " vip" : "");

    card.dataset.seat = i;

    // Avatar frame
    const avatar = document.createElement("div");
    avatar.className = "seat-avatar";

    if (seat) {
      const frameData =
        member?.frameData || seat.frameData || {};

      avatar.style.background =
        frameData.gradient ||
        "linear-gradient(135deg,#9333ea,#ec4899)";

      avatar.style.padding = "4px";
      avatar.style.boxSizing = "border-box";
      avatar.style.overflow = "hidden";
      avatar.style.borderRadius = "50%";

      const avatarInner = document.createElement("div");

      avatarInner.style.width = "100%";
      avatarInner.style.height = "100%";
      avatarInner.style.borderRadius = "50%";
      avatarInner.style.overflow = "hidden";
      avatarInner.style.background = "#241638";
      avatarInner.style.display = "grid";
      avatarInner.style.placeItems = "center";

      const avatarUrl =
        member?.avatar || seat.avatar || "";

      if (avatarUrl) {
        const img = document.createElement("img");

        img.src = avatarUrl;
        img.alt = "Profile";
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "cover";
        img.onerror = () => {
          img.remove();
          avatarInner.textContent = "👤";
        };

        avatarInner.appendChild(img);
      } else {
        avatarInner.textContent = "👤";
      }

            avatar.appendChild(avatarInner);

      // SVIP PROFILE FRAME
      const svipLevel = Number(member?.svipLevel || 0);
      const svipUntil = Number(member?.svipUntil || 0);

      if (
        svipLevel >= 1 &&
        svipLevel <= 11 &&
        svipUntil > Date.now()
      ) {
        const svipFrame = document.createElement("img");

        svipFrame.src =
          `/assets/svip_${String(svipLevel).padStart(2, "0")}.png`;

        svipFrame.alt = `SVIP ${svipLevel} Frame`;
        svipFrame.className = "room-svip-frame";

        svipFrame.onerror = () => {
          svipFrame.remove();
        };

        avatar.appendChild(svipFrame);
      }

    } else {
      avatar.textContent = "🎙️";
    }
     
    const name = document.createElement("b");

name.className = "member-name";

name.textContent = seat
  ? seat.name
  : i === 0
    ? "Host Seat"
    : `No.${i + 1}`;

// SEAT SVIP STYLISH NAME
const seatSvipLevel = Number(member?.svipLevel || 0);
const seatSvipUntil = Number(member?.svipUntil || 0);

const seatActiveSVIP =
  seatSvipLevel >= 1 &&
  seatSvipLevel <= 11 &&
  seatSvipUntil > Date.now();

if (seatActiveSVIP) {
  name.classList.add(`svip-name-${seatSvipLevel}`);
}

    const status = document.createElement("small");

    status.textContent = seat
      ? member?.micOn === false
        ? "🔇 Muted"
        : "🎙️ Online"
      : "Tap to Join";

    card.appendChild(avatar);
    card.appendChild(name);
    card.appendChild(status);

    card.addEventListener("click", () => {
      handleSeatClick(i);
    });

    if (i < 5) {
      vipContainer.appendChild(card);
    } else {
      normalContainer.appendChild(card);
    }
  }
}

async function handleSeatClick(index) {
  const seat = currentSeats[index];

  if (seat && seat.socketId !== socket.id) {
    toast("This seat is already occupied.");
    return;
  }

  if (seat && seat.socketId === socket.id) {
    const result = await emitWithReply("leave-seat");

    if (result.ok) {
      toast("You left the seat.");
    } else {
      toast(result.error || "Unable to leave seat.");
    }

    return;
  }

  const result = await emitWithReply(
    "take-seat",
    index
  );

  if (result.ok) {
    toast("Seat joined!");
  } else {
    toast(result.error || "Seat join failed.");
  }
}

/* ==========================================
   MEMBERS WITH PROFILE FRAMES
========================================== */

function renderMembers() {
  const list = $("membersList");

  if (!list) return;

  list.innerHTML = "";

  currentMembers.forEach(member => {
    const row = document.createElement("div");

    row.className = "member-item";

    // Member DP frame
    const avatarFrame = document.createElement("div");

    avatarFrame.className = "member-avatar-frame";

    const frameData = member.frameData || {};

    avatarFrame.style.width = "42px";
    avatarFrame.style.height = "42px";
    avatarFrame.style.minWidth = "42px";
    avatarFrame.style.padding = "3px";
    avatarFrame.style.boxSizing = "border-box";
    avatarFrame.style.borderRadius = "50%";

    avatarFrame.style.background =
      frameData.gradient ||
      "linear-gradient(135deg,#9333ea,#ec4899)";

    const avatarInner = document.createElement("div");

    avatarInner.style.width = "100%";
    avatarInner.style.height = "100%";
    avatarInner.style.borderRadius = "50%";
    avatarInner.style.overflow = "hidden";
    avatarInner.style.background = "#241638";
    avatarInner.style.display = "grid";
    avatarInner.style.placeItems = "center";

    if (member.avatar) {
      const img = document.createElement("img");

      img.src = member.avatar;
      img.alt = "Profile";
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";

      img.onerror = () => {
        img.remove();
        avatarInner.textContent = "👤";
      };

      avatarInner.appendChild(img);
    } else {
      avatarInner.textContent = "👤";
    }

      avatarFrame.appendChild(avatarInner);

    // SVIP PROFILE FRAME
    const svipLevel = Number(member.svipLevel || 0);
    const svipUntil = Number(member.svipUntil || 0);

    if (
      svipLevel >= 1 &&
      svipLevel <= 11 &&
      svipUntil > Date.now()
    ) {
      const svipFrame = document.createElement("img");

      svipFrame.src =
        `/assets/svip_${String(svipLevel).padStart(2, "0")}.png`;

      svipFrame.alt = `SVIP ${svipLevel} Frame`;
      svipFrame.className = "member-svip-frame";

      svipFrame.onerror = () => {
        svipFrame.remove();
      };

      avatarFrame.appendChild(svipFrame);
    }

const activeSVIP =
  svipLevel >= 1 &&
  svipLevel <= 11 &&
  svipUntil > Date.now();

const name = document.createElement("span");

name.className = "member-name";

if (activeSVIP) {
  name.classList.add(`svip-name-${svipLevel}`);
}

name.textContent =
  (member.isOwner ? "👑 " : "") +
  (member.isAdmin ? "🛡️ " : "") +
  member.name;

// PREMIUM USER ID
const userIdText = document.createElement("span");

userIdText.className = "member-id";
userIdText.textContent = `ID: ${member.id}`;

if (activeSVIP) {
  userIdText.classList.add(`svip-id-${svipLevel}`);
}

// SVIP BADGE
row.appendChild(avatarFrame);
row.appendChild(name);
row.appendChild(userIdText);

if (activeSVIP) {
  const badge = document.createElement("span");

  badge.className = "room-svip-badge";
  badge.textContent = ` 👑 SVIP ${svipLevel}`;

  row.appendChild(badge);
}

// MIC STATUS
const status = document.createElement("span");

status.textContent =
  member.micOn === false ? "🔇" : "🎙️";

row.appendChild(status);

    list.appendChild(row);
  });

  if ($("memberCount")) {
    $("memberCount").textContent = currentMembers.length;
  }

  if ($("membersTotal")) {
    $("membersTotal").textContent = currentMembers.length;
  }

  updateGiftReceivers();
}

function updateGiftReceivers() {
  const select = $("giftReceiver");

  if (!select) return;

  const oldValue = select.value;

  select.innerHTML =
    '<option value="">Everyone</option>';

  currentMembers.forEach(member => {
    if (member.id === userId) return;

    const option = document.createElement("option");

    option.value = member.id;
    option.textContent =
      member.name + " (ID: " + member.id + ")";

    select.appendChild(option);
  });

  select.value = oldValue;
}

/* ==========================================
   CHAT HISTORY
========================================== */

function renderChatHistory(messages) {
  const box = $("chatMessages");

  if (!box) return;

  box.innerHTML = "";

  messages.forEach(message => {
    appendChatMessage(message);
  });
}

function appendChatMessage(message) {
  const box = $("chatMessages");

  if (!box) return;

  const row = document.createElement("div");

  const member = currentMembers.find(
    item => String(item.id) === String(message.userId)
  );

  const svipLevel = Number(member?.svipLevel || 0);
  const svipUntil = Number(member?.svipUntil || 0);

  const activeSVIP =
    svipLevel >= 1 &&
    svipLevel <= 11 &&
    svipUntil > Date.now();

  row.className = activeSVIP
    ? `chat-message svip-chat svip-chat-${svipLevel}`
    : "chat-message";

  const name = document.createElement("span");

  name.className = "message-name";
  name.textContent = message.name || "Huka User";

  if (activeSVIP) {
    const badge = document.createElement("span");
    badge.className = "chat-svip-badge";
    badge.textContent = ` SVIP ${svipLevel}`;
    name.appendChild(badge);
  }

  const text = document.createElement("span");

  text.className = "message-text";
  text.textContent = message.text || "";

  const time = document.createElement("small");

  time.textContent = getTime(message.time);

  row.appendChild(name);
  row.appendChild(text);
  row.appendChild(time);

  box.appendChild(row);

  box.scrollTop = box.scrollHeight;
}

function appendSystemMessage(message) {
  const box = $("chatMessages");

  if (!box) return;

  const row = document.createElement("div");

  row.className = "system-message";
  row.textContent = message;

  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}

function appendGiftMessage(event) {
  const box = $("chatMessages");

  if (!box) return;

  const member = currentMembers.find(
    item => String(item.id) === String(event.fromId)
  );

  const level = Number(member?.svipLevel || 0);
  const expiry = Number(member?.svipUntil || 0);

  const activeSVIP =
    level >= 1 &&
    level <= 11 &&
    expiry > Date.now();

  const row = document.createElement("div");

  row.className = activeSVIP
    ? `chat-message gift-message svip-chat svip-chat-${level}`
    : "chat-message gift-message";

  const title = document.createElement("div");

  title.className = "message-name";

  title.textContent =
    `🎁 ${event.from || "User"}`;

  if (activeSVIP) {
    const badge = document.createElement("span");

    badge.className = "chat-svip-badge";
    badge.textContent = ` 👑 SVIP ${level}`;

    title.appendChild(badge);
  }

  const details = document.createElement("div");

  details.className = "message-text";

  details.textContent =
    `${event.gift} sent to ${event.to} • ${event.cost} Coins`;

  row.appendChild(title);
  row.appendChild(details);

  box.appendChild(row);

  box.scrollTop = box.scrollHeight;
}

/* ==========================================
   SEND CHAT
========================================== */

$("chatForm").addEventListener("submit", event => {
  event.preventDefault();

  const input = $("chatInput");
  const text = input.value.trim();

  if (!text) return;

  socket.emit("room-message", {
    text: text
  });

  input.value = "";
});

/* ==========================================
   CHAT TABS
========================================== */

document.querySelectorAll(".chat-tab").forEach(button => {
  button.addEventListener("click", () => {

    document.querySelectorAll(".chat-tab")
      .forEach(item => item.classList.remove("active"));

    button.classList.add("active");

    selectedTab = button.dataset.tab;

    document.querySelectorAll(
      ".chat-message, .system-message"
    ).forEach(message => {

      if (selectedTab === "all") {
        message.style.display = "";
      } else if (selectedTab === "chat") {
        message.style.display =
          message.classList.contains("gift-message")
            ? "none"
            : "";
      } else {
        message.style.display =
          message.classList.contains("gift-message")
            ? ""
            : "none";
      }
    });
  });
});

/* ==========================================
   EMOJI PANEL
========================================== */

$("emojiButton").addEventListener("click", () => {
  $("emojiPanel").classList.toggle("hidden");
  $("morePanel").classList.add("hidden");
});

$("emojiPanel").addEventListener("click", event => {
  const button = event.target.closest("[data-emoji]");

  if (!button) return;

  socket.emit("send-emoji", {
    emoji: button.dataset.emoji
  });

  $("emojiPanel").classList.add("hidden");
});

function showEmojiEvent(data) {
  appendSystemMessage(
    `${data.name}: ${data.emoji}`
  );
}

/* ==========================================
   GIFT SYSTEM
========================================== */

function loadGifts() {
  socket.emit("get-gifts", response => {

    if (!response || !response.ok) return;

    giftPrices = response.gifts || {};

    renderGiftList();
  });
}

function renderGiftList() {
  const box = $("giftList");

  if (!box) return;

  box.innerHTML = "";

  const giftEmojis = {
    Rose: "🌹",
    Heart: "💗",
    Crown: "👑",
    Diamond: "💎",
    Rocket: "🚀",
    Castle: "🏰",
    Galaxy: "🌌"
  };

  Object.entries(giftPrices).forEach(([name, price]) => {
    const button = document.createElement("button");

    button.dataset.gift = name;

    button.innerHTML = `
      ${giftEmojis[name] || "🎁"}<br>
      ${escapeHTML(name)}<br>
      ${Number(price)} Coins
    `;

    button.addEventListener("click", () => {

      selectedGift = name;

      box.querySelectorAll("button")
        .forEach(item => item.classList.remove("selected"));

      button.classList.add("selected");
    });

    box.appendChild(button);
  });
}

$("giftButton").addEventListener("click", () => {
  selectedGift = "";

  $("giftCoins").textContent = currentCoins;

  showModal("giftModal");
});

$("sendGiftButton").addEventListener("click", async () => {
  if (!selectedGift) {
    toast("Pehle gift select karo.");
    return;
  }

  const receiver = $("giftReceiver").value || "";

  const result = await emitWithReply("send-gift", {
    gift: selectedGift,
    to: receiver
  });

  if (!result.ok) {
    toast(result.error || "Gift send nahi hua.");
    return;
  }

  currentCoins = Number(result.coins || 0);

  updateCoins();

  $("giftCoins").textContent = currentCoins;

  toast("Gift sent successfully!");

  hideModal("giftModal");
});

function updateGiftRanking(ranking) {
  const box = $("giftRanking");

  if (!box) return;

  box.innerHTML = "";

  (ranking || []).forEach((item, index) => {
    const row = document.createElement("div");

    row.className = "ranking-item";

    row.textContent =
      `${index + 1}. ${item.name} — ${item.coins} Coins`;

    box.appendChild(row);
  });
}

function showGiftNotification(event) {
  const box = $("giftNotification");

  const member = currentMembers.find(
    item => String(item.id) === String(event.fromId)
  );

  const level = Number(member?.svipLevel || 0);
  const expiry = Number(member?.svipUntil || 0);

  const activeSVIP =
    level >= 1 &&
    level <= 11 &&
    expiry > Date.now();

  $("giftNotificationText").textContent =
    `🎁 ${event.from} sent ${event.gift} to ${event.to} × ${event.cost}`;

  box.classList.remove("hidden");

  clearTimeout(notificationTimer);

  notificationTimer = setTimeout(() => {
    box.classList.add("hidden");
  }, 5000);

  appendGiftMessage(event);

  if (activeSVIP) {
    showSVIPGiftEffect(event, level);
  }
}

function showSVIPGiftEffect(event, level) {
  const effect = document.createElement("div");

  effect.className = `svip-gift-effect svip-gift-${level}`;

  const card = document.createElement("div");
  card.className = "svip-gift-card";

  const crown = document.createElement("div");
  crown.className = "svip-gift-crown";
  crown.textContent = "👑";

  const title = document.createElement("div");
  title.className = "svip-gift-title";
  title.textContent = `SVIP ${level}`;

  const sender = document.createElement("div");
  sender.className = "svip-gift-sender";
  sender.textContent = event.from || "Huka User";

  const gift = document.createElement("div");
  gift.className = "svip-gift-icon";
  gift.textContent = "🎁 " + (event.gift || "Gift");

  const receiver = document.createElement("div");
  receiver.className = "svip-gift-receiver";
  receiver.textContent = `Sent to ${event.to || "Everyone"}`;

  card.append(crown, title, sender, gift, receiver);
  effect.appendChild(card);

  document.body.appendChild(effect);

  setTimeout(() => {
    effect.remove();
  }, 3500);
}

/* ==========================================
   COINS
========================================== */

function updateCoins() {
  if ($("giftCoins")) {
    $("giftCoins").textContent = currentCoins;
  }

  localStorage.setItem("hukaCoins", currentCoins);
}

/* ==========================================
   MIC BUTTON
========================================== */

function updateMicButton() {
  const button = $("micButton");

  if (!button) return;

  button.textContent = micEnabled ? "🎙️" : "🔇";

  button.title = micEnabled
    ? "Microphone ON"
    : "Microphone OFF";
}

async function enableMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Microphone ke liye HTTPS connection zaroori hai.");
    return false;
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    micStream.getAudioTracks().forEach(track => {
      track.enabled = true;
    });

    micEnabled = true;

    socket.emit("mic-state", {
      micOn: true
    });

    updateMicButton();

    // Existing room members ko audio offer bhejo.
    peerConnections.forEach((pc, peerId) => {
      micStream.getTracks().forEach(track => {
        const alreadyAdded = pc.getSenders().some(
          sender => sender.track?.id === track.id
        );

        if (!alreadyAdded) {
          pc.addTrack(track, micStream);
        }
      });

      makeOffer(peerId, pc);
    });

    toast("Microphone ON");
    return true;

  } catch (error) {
    console.error("Microphone error:", error);

    toast("Microphone permission allow karo.");
    return false;
  }
}

function disableMicrophone() {
  if (micStream) {
    micStream.getTracks().forEach(track => {
      track.enabled = false;
    });
  }

  micEnabled = false;

  socket.emit("mic-state", {
    micOn: false
  });

  updateMicButton();

  toast("Microphone OFF");
}

$("micButton").addEventListener("click", async () => {
  if (micEnabled) {
    disableMicrophone();
  } else {
    await enableMicrophone();
  }
});

/* ==========================================
   SPEAKER BUTTON
========================================== */

$("speakerButton").addEventListener("click", () => {
  speakerEnabled = !speakerEnabled;

  remoteAudioElements.forEach(audio => {
    audio.muted = !speakerEnabled;
  });

  $("speakerButton").textContent =
    speakerEnabled ? "🔊" : "🔇";

  toast(
    speakerEnabled
      ? "Speaker ON"
      : "Speaker OFF"
  );
});

/* ==========================================
   WEBRTC VOICE CHAT
========================================== */

const rtcConfig = {
  iceServers: [
    {
      urls: "stun:stun.l.google.com:19302"
    },
    {
      urls: "stun:stun1.l.google.com:19302"
    }
  ]
};

function createPeer(peerId) {
  if (peerConnections.has(peerId)) {
    return peerConnections.get(peerId);
  }

  const pc = new RTCPeerConnection(rtcConfig);

  peerConnections.set(peerId, pc);

  if (micStream) {
    micStream.getTracks().forEach(track => {
      pc.addTrack(track, micStream);
    });
  }

  pc.onicecandidate = event => {
    if (event.candidate) {
      socket.emit("voice-ice", {
        to: peerId,
        candidate: event.candidate
      });
    }
  };

  pc.ontrack = event => {
    let audio = remoteAudioElements.get(peerId);

    if (!audio) {
      audio = document.createElement("audio");

      audio.autoplay = true;
      audio.playsInline = true;

      audio.muted = !speakerEnabled;

      document.body.appendChild(audio);

      remoteAudioElements.set(peerId, audio);
    }

    audio.srcObject = event.streams[0];

    audio.play().catch(error => {
      console.log("Audio playback waiting:", error);
    });
  };

  pc.onconnectionstatechange = () => {
    if (
      pc.connectionState === "failed" ||
      pc.connectionState === "closed"
    ) {
      removePeer(peerId);
    }
  };

  return pc;
}

async function makeOffer(peerId, pc) {
  if (!micStream) return;

  try {
    const offer = await pc.createOffer();

    await pc.setLocalDescription(offer);

    socket.emit("voice-offer", {
      to: peerId,
      offer: pc.localDescription
    });

  } catch (error) {
    console.error("Offer error:", error);
  }
}

async function receiveOffer(data) {
  try {
    const pc = createPeer(data.from);

    await pc.setRemoteDescription(
      new RTCSessionDescription(data.offer)
    );

    if (micStream) {
      micStream.getTracks().forEach(track => {
        const alreadyAdded = pc.getSenders().some(
          sender => sender.track?.id === track.id
        );

        if (!alreadyAdded) {
          pc.addTrack(track, micStream);
        }
      });
    }

    const answer = await pc.createAnswer();

    await pc.setLocalDescription(answer);

    socket.emit("voice-answer", {
      to: data.from,
      answer: pc.localDescription
    });

  } catch (error) {
    console.error("Receive offer error:", error);
  }
}

async function receiveAnswer(data) {
  try {
    const pc = peerConnections.get(data.from);

    if (!pc) return;

    await pc.setRemoteDescription(
      new RTCSessionDescription(data.answer)
    );

  } catch (error) {
    console.error("Receive answer error:", error);
  }
}

async function receiveIce(data) {
  try {
    const pc = peerConnections.get(data.from);

    if (!pc || !data.candidate) return;

    await pc.addIceCandidate(
      new RTCIceCandidate(data.candidate)
    );

  } catch (error) {
    console.error("ICE error:", error);
  }
}

function removePeer(peerId) {
  const pc = peerConnections.get(peerId);

  if (pc) {
    pc.close();
    peerConnections.delete(peerId);
  }

  const audio = remoteAudioElements.get(peerId);

  if (audio) {
    audio.pause();
    audio.srcObject = null;
    audio.remove();

    remoteAudioElements.delete(peerId);
  }
}

function closeAllPeers() {
  [...peerConnections.keys()].forEach(removePeer);
}

/* ==========================================
   INBOX
========================================== */

function loadInbox() {
  socket.emit("get-inbox");
}

$("inboxButton").addEventListener("click", () => {
  loadInbox();
  showModal("inboxModal");
});

function renderInbox(messages) {
  const box = $("inboxMessages");

  if (!box) return;

  box.innerHTML = "";

  if (!messages || messages.length === 0) {
    box.textContent = "No new messages.";
    return;
  }

  messages.slice(-50).reverse().forEach(message => {
    const row = document.createElement("div");

    row.className = "system-message";

    row.textContent =
      `${message.from || "User"}: ${message.text || ""} (${getTime(message.time)})`;

    box.appendChild(row);
  });
}

/* ==========================================
   MORE MENU
========================================== */

$("moreButton").addEventListener("click", () => {
  $("morePanel").classList.toggle("hidden");
  $("emojiPanel").classList.add("hidden");
});

$("membersButton").addEventListener("click", () => {
  $("morePanel").classList.add("hidden");

  $("membersList").scrollIntoView({
    behavior: "smooth"
  });
});

$("rankingButton").addEventListener("click", () => {
  $("morePanel").classList.add("hidden");

  $("giftRanking").scrollIntoView({
    behavior: "smooth"
  });
});

$("leaveSeatButton").addEventListener("click", async () => {
  const result = await emitWithReply("leave-seat");

  toast(
    result.ok
      ? "Seat left."
      : result.error || "Unable to leave seat."
  );

  $("morePanel").classList.add("hidden");
});

$("clearChatButton").addEventListener("click", async () => {
  const result = await emitWithReply("clear-chat");

  if (!result.ok) {
    toast(result.error || "Only Owner/Admin can clear chat.");
  } else {
    toast("Chat cleared.");
  }

  $("morePanel").classList.add("hidden");
});

/* ==========================================
   YOUTUBE SHARING
========================================== */

$("youtubeButton").addEventListener("click", () => {
  $("morePanel").classList.add("hidden");
  showModal("youtubeModal");
});

$("shareYoutubeButton").addEventListener("click", async () => {
  const url = $("youtubeInput").value.trim();

  if (!url) {
    toast("YouTube link paste karo.");
    return;
  }

  const result = await emitWithReply("share-youtube", {
    url
  });

  if (!result.ok) {
    toast(result.error || "Link share nahi hua.");
    return;
  }

  $("youtubeInput").value = "";

  toast("YouTube link shared!");
  hideModal("youtubeModal");
});

function showYoutubeLink(event) {
  const box = $("youtubeLinks");

  if (!box) return;

  const row = document.createElement("div");

  row.className = "system-message";

  const link = document.createElement("a");

  link.href = event.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "▶ Open YouTube link";

  row.appendChild(link);

  box.appendChild(row);

  appendSystemMessage(
    `${event.by} shared a YouTube link.`
  );
}

/* ==========================================
   ROOM SETTINGS
========================================== */

$("settingsButton").addEventListener("click", () => {
  $("morePanel").classList.add("hidden");

  updateRoomSettings(currentSettings);

  // Add seat count option if not already present.
  if (!$("settingSeats")) {
    const label = document.createElement("label");

    label.textContent = "Seat Count";
    label.htmlFor = "settingSeats";

    const select = document.createElement("select");

    select.id = "settingSeats";

    [9, 11, 15, 20].forEach(number => {
      const option = document.createElement("option");

      option.value = number;
      option.textContent = number + " Seats";

      select.appendChild(option);
    });

    select.value = currentSettings.seats || currentSeats.length || 9;

    const saveButton = $("saveSettingsButton");

    saveButton.parentNode.insertBefore(label, saveButton);
    saveButton.parentNode.insertBefore(select, saveButton);
  }

  showModal("settingsModal");
});

$("saveSettingsButton").addEventListener("click", async () => {
  const data = {
    name: $("settingRoomName").value.trim(),
    description: $("settingDescription").value.trim(),
    locked: $("settingLocked").checked,
    allowYoutube: $("settingYoutube").checked,
    seats: Number($("settingSeats")?.value || currentSeats.length || 9)
  };

  const result = await emitWithReply(
    "update-room-settings",
    data
  );

  if (!result.ok) {
    toast(result.error || "Settings save nahi hui.");
    return;
  }

  toast("Room settings saved!");

  hideModal("settingsModal");
});

/* ==========================================
   ADMIN BUTTON
========================================== */

function addAdminButtonToMenu() {
  if ($("adminMenuButton")) return;

  const button = document.createElement("button");

  button.id = "adminMenuButton";
  button.textContent = "🛡️ Admin Panel";

  button.addEventListener("click", () => {
    $("morePanel").classList.add("hidden");
    showModal("adminModal");
  });

  $("morePanel").appendChild(button);
}

addAdminButtonToMenu();

$("addAdminButton").addEventListener("click", async () => {
  const targetId = $("adminUserId").value.trim();

  if (!targetId) {
    toast("User ID enter karo.");
    return;
  }

  const result = await emitWithReply(
    "add-room-admin",
    { userId: targetId }
  );

  toast(
    result.ok
      ? "Admin added."
      : result.error || "Admin add nahi hua."
  );
});

$("removeAdminButton").addEventListener("click", async () => {
  const targetId = $("adminUserId").value.trim();

  if (!targetId) {
    toast("User ID enter karo.");
    return;
  }

  const result = await emitWithReply(
    "remove-room-admin",
    { userId: targetId }
  );

  toast(
    result.ok
      ? "Admin removed."
      : result.error || "Admin remove nahi hua."
  );
});

$("kickUserButton").addEventListener("click", async () => {
  const targetId = $("adminUserId").value.trim();

  if (!targetId) {
    toast("User ID enter karo.");
    return;
  }

  const result = await emitWithReply(
    "kick-member",
    { userId: targetId }
  );

  toast(
    result.ok
      ? "Member removed."
      : result.error || "Member remove nahi hua."
  );
});

$("muteUserButton").addEventListener("click", async () => {
  const targetId = $("adminUserId").value.trim();

  if (!targetId) {
    toast("User ID enter karo.");
    return;
  }

  const result = await emitWithReply(
    "force-mute",
    { userId: targetId }
  );

  toast(
    result.ok
      ? "Member muted."
      : result.error || "Mute nahi hua."
  );
});

/* ==========================================
   SHARE ROOM
========================================== */

$("shareButton").addEventListener("click", async () => {
  const shareUrl = location.href;

  if (navigator.share) {
    try {
      await navigator.share({
        title: "Huka Voice Chat",
        text: "Join my Huka Voice Room!",
        url: shareUrl
      });
    } catch (error) {
      console.log("Share cancelled.");
    }
  } else if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast("Room link copied!");
    } catch (error) {
      toast("Link copy nahi hua.");
    }
  } else {
    toast("Share is not available in this browser.");
  }
});

/* ==========================================
   EXIT ROOM
========================================== */

function exitRoom() {
  socket.emit("leave-room");

  disableMicrophone();
  closeAllPeers();

  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }

  localStorage.removeItem("hukaRoomId");

  location.href = "index.html";
}

$("exitButton").addEventListener("click", exitRoom);

$("backButton").addEventListener("click", exitRoom);

/* ==========================================
   MODAL CLOSE BUTTONS
========================================== */

document.querySelectorAll("[data-close]").forEach(button => {
  button.addEventListener("click", () => {
    hideModal(button.dataset.close);
  });
});

document.querySelectorAll(".modal").forEach(modal => {
  modal.addEventListener("click", event => {
    if (event.target === modal) {
      modal.classList.add("hidden");
    }
  });
});

/* ==========================================
   SOCKET EVENTS
========================================== */

socket.on("connect", () => {
  $("roomStatus").textContent = "🟢 Connected";

  registerUser();
});

socket.on("disconnect", () => {
  $("roomStatus").textContent = "🔴 Disconnected";
});

socket.on("connect_error", error => {
  console.error("Socket error:", error);
  $("roomStatus").textContent = "🔴 Connection error";
});

socket.on("members-update", data => {
  const newMembers = data.members || [];

  currentMembers = newMembers;

  renderMembers();
  renderSeats();
});

socket.on("svip-entry", member => {
  if (!member) return;

  showSVIPEntryEffect(member);
});

socket.on("seats-update", seats => {
  currentSeats = seats || [];

  renderSeats();
});

socket.on("room-settings-update", settings => {
  updateRoomSettings(settings);
});

socket.on("room-message", message => {
  appendChatMessage(message);
});

socket.on("system-message", message => {
  appendSystemMessage(message);
});

socket.on("chat-cleared", data => {
  $("chatMessages").innerHTML = "";

  appendSystemMessage(
    "Chat cleared by " + data.by
  );
});

socket.on("emoji-event", data => {
  showEmojiEvent(data);
});

socket.on("gift-event", event => {
  showGiftNotification(event);
});

socket.on("gift-ranking", ranking => {
  updateGiftRanking(ranking);
});

socket.on("profile-update", profile => {
  currentCoins = Number(profile.coins || 0);

  updateCoins();
});

socket.on("inbox-data", messages => {
  renderInbox(messages);
});

socket.on("new-dm", message => {
  toast("New inbox message from " + message.from);
});

socket.on("mic-update", data => {
  const member = currentMembers.find(
    item => item.socketId === data.socketId
  );

  if (member) {
    member.micOn = data.micOn;
    renderMembers();
    renderSeats();
  }
});

socket.on("force-mute", data => {
  if (data.muted) {
    disableMicrophone();
    toast("Admin ne microphone mute kar diya.");
  }
});

socket.on("kicked-from-room", data => {
  toast(data.message || "You were removed from room.");

  setTimeout(exitRoom, 1500);
});

socket.on("locked-seats-update", seats => {
  appendSystemMessage(
    "Seat lock settings updated."
  );
});

socket.on("room-admins-update", admins => {
  appendSystemMessage(
    "Room admin list updated."
  );
});

socket.on("youtube-link", event => {
  showYoutubeLink(event);
});

/* ==========================================
   WEBRTC SOCKET EVENTS
========================================== */

socket.on("voice-existing-peers", peerIds => {
  (peerIds || []).forEach(peerId => {
    if (micStream) {
      const pc = createPeer(peerId);
      makeOffer(peerId, pc);
    }
  });
});

socket.on("voice-peer-joined", data => {
  if (!data?.socketId) return;

  if (micStream) {
    createPeer(data.socketId);
  }
});

socket.on("voice-offer", data => {
  receiveOffer(data);
});

socket.on("voice-answer", data => {
  receiveAnswer(data);
});

socket.on("voice-ice", data => {
  receiveIce(data);
});

socket.on("voice-peer-left", data => {
  if (data?.socketId) {
    removePeer(data.socketId);
  }
});

/* ==========================================
   SVIP SPECIAL ROOM ENTRY EFFECT
========================================== */

function showSVIPEntryEffect(member) {
  const effect = document.createElement("div");

  effect.className = "svip-entry-effect";

  const level = Number(member.svipLevel || 1);
  const name = String(member.name || "SVIP User")
    .replace(/[<>&"]/g, "");

  effect.innerHTML = `
    <div class="svip-entry-card">
      <div class="svip-entry-crown">👑</div>
      <div class="svip-entry-level">SVIP ${level} ${name}</div>
    </div>
  `;

  document.body.appendChild(effect);

  setTimeout(() => {
    effect.remove();
  }, 3500);
  }

/* ==========================================
   CLEANUP
========================================== */

window.addEventListener("beforeunload", () => {
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
  }

  closeAllPeers();
});
