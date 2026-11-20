"use strict";

/* =====================================
   HUKA VOICE CHAT - ROOM JS
===================================== */

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
  "Huka User";

const $ = id => document.getElementById(id);

let currentUser = null;
let currentRoom = null;
let localStream = null;
let micEnabled = false;
let speakerEnabled = true;

const peerConnections = {};

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

/* =====================================
   STATUS
===================================== */

function status(message) {
  const element = $("roomStatus");

  if (element) element.textContent = message;
}

function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]
  );
}

/* =====================================
   REGISTER
===================================== */

socket.on("connect", () => {
  status("Connected");

  socket.emit("register", {
    userId: USER_ID,
    name: USER_NAME
  }, result => {
    if (!result || !result.ok) {
      status("Registration failed");
      return;
    }

    currentUser = result.user;

    localStorage.setItem("hukaUserId", currentUser.id);
    localStorage.setItem("hukaName", currentUser.name);

    joinRoom();
  });
});

socket.on("disconnect", () => {
  status("Disconnected. Reconnecting...");
});

/* =====================================
   JOIN ROOM
===================================== */

function joinRoom() {
  if (!ROOM_ID) {
    status("Room ID missing");
    return;
  }

  socket.emit("join-room", {
    roomId: ROOM_ID
  }, result => {
    if (!result || !result.ok) {
      status(result?.error || "Unable to join room");
      return;
    }

    currentRoom = result.room;

    status("You joined the room");

    renderMembers(result.members || []);

    socket.emit("get-gifts");
    socket.emit("get-inbox");
    socket.emit("voice-existing-peers");
  });
}

socket.on("room-joined", result => {
  if (!result || !result.ok) return;

  currentRoom = result.room;
  renderMembers(result.members || []);
});

/* =====================================
   ROOM UPDATE
===================================== */

socket.on("members-update", data => {
  if (!data) return;

  if (data.room) {
    currentRoom = data.room;
  }

  renderMembers(data.members || []);

  const count = $("memberCount");

  if (count) {
    count.textContent = data.memberCount || 0;
  }

  const roomName = $("roomName");

  if (roomName && data.room) {
    roomName.textContent = data.room.name;
  }
});

/* =====================================
   MEMBERS AND SEATS
===================================== */

function renderMembers(members) {
  const container = $("members");

  if (container) {
    container.innerHTML = members.map(member => `
      <div class="member">
        ${escapeHTML(member.name)}
        ${member.role === "owner" ? " 👑" : ""}
        ${member.role === "admin" ? " 🛡️" : ""}
      </div>
    `).join("");
  }

  renderSeats(members);
}

function renderSeats(members) {
  const container = $("seats");

  if (!container) return;

  const seatCount =
    currentRoom?.seats
      ? Object.keys(currentRoom.seats).length
      : 9;

  const seats = currentRoom?.seats || {};

  container.innerHTML = "";

  for (let i = 1; i <= seatCount; i++) {
    const userId = seats[i];
    const member = members.find(
      item => item.id === userId
    );

    const button = document.createElement("button");

    button.className = "seat";

    button.innerHTML = member
      ? `<strong>${escapeHTML(member.name)}</strong>
         <small>Seat ${i}</small>`
      : `<strong>🎙️ Empty</strong>
         <small>Seat ${i}</small>`;

    button.addEventListener("click", () => {
      if (member) {
        if (member.id === currentUser?.id) {
          leaveSeat();
        }
      } else {
        takeSeat(i);
      }
    });

    container.appendChild(button);
  }
}

function takeSeat(seat) {
  socket.emit("take-seat", { seat }, result => {
    if (!result?.ok) {
      alert(result?.error || "Unable to take seat");
    }
  });
}

function leaveSeat() {
  socket.emit("leave-seat");
}

/* =====================================
   ROOM CHAT
===================================== */

function sendMessage() {
  const input = $("chatInput");

  if (!input) return;

  const message = input.value.trim();

  if (!message) return;

  socket.emit("room-message", {
    text: message
  });

  input.value = "";
}

const sendButton = $("sendMessage");

if (sendButton) {
  sendButton.addEventListener("click", sendMessage);
}

const chatInput = $("chatInput");

if (chatInput) {
  chatInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      sendMessage();
    }
  });
}

socket.on("room-message", message => {
  const container = $("chatMessages");

  if (!container || !message) return;

  const item = document.createElement("div");

  item.className = "chat-message";

  item.innerHTML = `
    <strong>${escapeHTML(message.name)}:</strong>
    ${escapeHTML(message.text)}
  `;

  container.appendChild(item);
  container.scrollTop = container.scrollHeight;
});

socket.on("chat-cleared", () => {
  const container = $("chatMessages");

  if (container) container.innerHTML = "";
});

/* =====================================
   EMOJI
===================================== */

function sendEmoji(emoji) {
  socket.emit("send-emoji", { emoji });
}

socket.on("emoji-event", data => {
  const container = $("chatMessages");

  if (!container) return;

  const item = document.createElement("div");

  item.className = "emoji-event";

  item.textContent =
    data.name + " " + data.emoji;

  container.appendChild(item);
});

/* =====================================
   MIC
===================================== */

async function toggleMic() {
  try {
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
    }

    micEnabled = !micEnabled;

    localStream.getAudioTracks().forEach(track => {
      track.enabled = micEnabled;
    });

    socket.emit("mic-state", {
      mic: micEnabled
    });

    updateMicButton();

  } catch (error) {
    alert("Microphone permission is required.");
    console.error(error);
  }
}

function updateMicButton() {
  const button =
    $("micButton") ||
    $("bottomMicButton") ||
    $("micBtn");

  if (button) {
    button.textContent = micEnabled
      ? "🎙️ Mic ON"
      : "🔇 Mic OFF";
  }
}

const micButton =
  $("micButton") ||
  $("bottomMicButton") ||
  $("micBtn");

if (micButton) {
  micButton.addEventListener("click", toggleMic);
}

/* =====================================
   SPEAKER
===================================== */

function toggleSpeaker() {
  speakerEnabled = !speakerEnabled;

  document.querySelectorAll("audio").forEach(audio => {
    audio.muted = !speakerEnabled;
  });

  const button =
    $("speakerButton") ||
    $("speakerBtn");

  if (button) {
    button.textContent = speakerEnabled
      ? "🔊 Speaker ON"
      : "🔇 Speaker OFF";
  }
}

const speakerButton =
  $("speakerButton") ||
  $("speakerBtn");

if (speakerButton) {
  speakerButton.addEventListener("click", toggleSpeaker);
}

/* =====================================
   GIFTS
===================================== */

socket.on("gift-list", data => {
  renderGifts(data.gifts || []);
});

function renderGifts(gifts) {
  const container = $("giftList");

  if (!container) return;

  container.innerHTML = "";

  gifts.forEach(gift => {
    const button = document.createElement("button");

    button.innerHTML = `
      ${gift.emoji}
      ${escapeHTML(gift.name)}
      <br>
      🪙 ${gift.price}
    `;

    button.addEventListener("click", () => {
      sendGift(gift.id);
    });

    container.appendChild(button);
  });
}

function sendGift(giftId) {
  const receiver = $("giftReceiver");

  socket.emit("send-gift", {
    giftId,
    receiverId: receiver?.value || currentUser?.id,
    quantity: 1
  }, result => {
    if (!result?.ok) {
      alert(result?.error || "Gift failed");
      return;
    }

    const coins = $("coins");

    if (coins) {
      coins.textContent = result.coins;
    }
  });
}

socket.on("gift-event", data => {
  const container = $("chatMessages");

  if (!container) return;

  const item = document.createElement("div");

  item.className = "gift-event";

  item.textContent =
    `${data.senderName} sent ${data.emoji} ${data.gift} to ${data.receiverName}`;

  container.appendChild(item);
});

socket.on("coins-update", data => {
  const coins = $("coins");

  if (coins) coins.textContent = data.coins;
});

/* =====================================
   GIFT RANKING
===================================== */

socket.on("gift-ranking", data => {
  const container = $("giftRanking");

  if (!container) return;

  container.innerHTML = "";

  (data.ranking || []).forEach((user, index) => {
    const item = document.createElement("div");

    item.textContent =
      `${index + 1}. ${user.name} - ${user.coins} coins`;

    container.appendChild(item);
  });
});

/* =====================================
   INBOX
===================================== */

function openInbox() {
  socket.emit("get-inbox");
  showModal("inboxModal");
}

socket.on("inbox-messages", data => {
  const container = $("inboxMessages");

  if (!container) return;

  container.innerHTML = "";

  (data.messages || []).forEach(message => {
    const item = document.createElement("div");

    item.textContent =
      `${message.senderName}: ${message.message}`;

    container.appendChild(item);
  });
});

/* =====================================
   MODALS
===================================== */

function showModal(id) {
  const modal = $(id);

  if (modal) {
    modal.style.display = "flex";
  }
}

function hideModal(id) {
  const modal = $(id);

  if (modal) {
    modal.style.display = "none";
  }
}

/* =====================================
   YOUTUBE
===================================== */

function shareYoutube() {
  const input = $("youtubeInput");

  if (!input) return;

  const url = input.value.trim();

  if (!url) return;

  socket.emit("share-youtube", { url });

  input.value = "";
}

socket.on("youtube-shared", data => {
  const container = $("youtubeLinks");

  if (!container) return;

  const link = document.createElement("a");

  link.href = data.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = data.name + " shared YouTube";

  container.appendChild(link);
});

/* =====================================
   ADMIN
===================================== */

function clearChat() {
  socket.emit("clear-chat");
}

function kickMember(userId) {
  socket.emit("kick-member", { userId });
}

function addAdmin(userId) {
  socket.emit("add-room-admin", { userId });
}

function removeAdmin(userId) {
  socket.emit("remove-room-admin", { userId });
}

function forceMute(userId) {
  socket.emit("force-mute", { userId });
}

/* =====================================
   ROOM SETTINGS
===================================== */

function saveRoomSettings() {
  socket.emit("update-room-settings", {
    name: $("settingRoomName")?.value,
    description: $("settingDescription")?.value,
    locked: $("roomLocked")?.checked,
    youtubeAllowed: $("youtubeAllowed")?.checked
  }, result => {
    if (!result?.ok) {
      alert(result?.error || "Settings not saved");
    } else {
      alert("Room settings saved");
    }
  });
}

/* =====================================
   WEBRTC
===================================== */

function createPeerConnection(userId) {
  if (peerConnections[userId]) {
    return peerConnections[userId];
  }

  const pc = new RTCPeerConnection(ICE_SERVERS);

  peerConnections[userId] = pc;

  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  pc.onicecandidate = event => {
    if (event.candidate) {
      socket.emit("voice-ice", {
        candidate: event.candidate
      });
    }
  };

  pc.ontrack = event => {
    let audio = $("audio-" + userId);

    if (!audio) {
      audio = document.createElement("audio");
      audio.id = "audio-" + userId;
      audio.autoplay = true;
      document.body.appendChild(audio);
    }

    audio.srcObject = event.streams[0];
    audio.muted = !speakerEnabled;
  };

  return pc;
}

socket.on("voice-existing-peers", async peers => {
  for (const userId of peers) {
    await createOffer(userId);
  }
});

socket.on("voice-peer-joined", async data => {
  if (!data?.userId) return;

  await createOffer(data.userId);
});

async function createOffer(userId) {
  try {
    const pc = createPeerConnection(userId);

    const offer = await pc.createOffer();

    await pc.setLocalDescription(offer);

    socket.emit("voice-offer", {
      offer
    });

  } catch (error) {
    console.error("Offer error:", error);
  }
}

socket.on("voice-offer", async data => {
  try {
    const userId = data.userId || data.from;

    if (!userId || !data.offer) return;

    const pc = createPeerConnection(userId);

    await pc.setRemoteDescription(
      new RTCSessionDescription(data.offer)
    );

    const answer = await pc.createAnswer();

    await pc.setLocalDescription(answer);

    socket.emit("voice-answer", {
      answer
    });

  } catch (error) {
    console.error("Answer error:", error);
  }
});

socket.on("voice-answer", async data => {
  try {
    const userId = data.userId || data.from;

    if (!userId || !data.answer) return;

    const pc = peerConnections[userId];

    if (pc) {
      await pc.setRemoteDescription(
        new RTCSessionDescription(data.answer)
      );
    }

  } catch (error) {
    console.error(error);
  }
});

socket.on("voice-ice", async data => {
  try {
    const userId = data.userId || data.from;

    if (!userId || !data.candidate) return;

    const pc = peerConnections[userId];

    if (pc) {
      await pc.addIceCandidate(
        new RTCIceCandidate(data.candidate)
      );
    }

  } catch (error) {
    console.error(error);
  }
});

socket.on("voice-peer-left", data => {
  const pc = peerConnections[data.userId];

  if (pc) {
    pc.close();
    delete peerConnections[data.userId];
  }

  const audio = $("audio-" + data.userId);

  if (audio) audio.remove();
});

/* =====================================
   KICKED
===================================== */

socket.on("kicked-from-room", data => {
  alert(data.message || "Removed from room");

  location.href = "index.html";
});

/* =====================================
   LEAVE ROOM
===================================== */

function leaveRoom() {
  socket.emit("leave-room", () => {
    location.href = "index.html";
  });
}

window.addEventListener("beforeunload", () => {
  socket.emit("leave-room");
});

/* =====================================
   BUTTON CONNECTIONS
===================================== */

const clearButton = $("clearChatButton");

if (clearButton) {
  clearButton.addEventListener("click", clearChat);
}

const inboxButton = $("inboxButton");

if (inboxButton) {
  inboxButton.addEventListener("click", openInbox);
}

const youtubeButton = $("youtubeButton");

if (youtubeButton) {
  youtubeButton.addEventListener("click", shareYoutube);
}

const settingsButton = $("saveRoomSettings");

if (settingsButton) {
  settingsButton.addEventListener("click", saveRoomSettings);
}

const leaveButton = $("leaveRoom");

if (leaveButton) {
  leaveButton.addEventListener("click", leaveRoom);
}

/* =====================================
   GLOBAL FUNCTIONS
===================================== */

window.sendEmoji = sendEmoji;
window.sendGift = sendGift;
window.takeSeat = takeSeat;
window.leaveSeat = leaveSeat;
window.openInbox = openInbox;
window.showModal = showModal;
window.hideModal = hideModal;
window.leaveRoom = leaveRoom;
window.clearChat = clearChat;
window.shareYoutube = shareYoutube;
window.toggleMic = toggleMic;
window.toggleSpeaker = toggleSpeaker;
window.kickMember = kickMember;
window.addAdmin = addAdmin;
window.removeAdmin = removeAdmin;
window.forceMute = forceMute;
window.saveRoomSettings = saveRoomSettings;
