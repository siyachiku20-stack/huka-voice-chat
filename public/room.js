javascript
"use strict";

// ==========================================
// HUKA VOICE CHAT - ROOM JAVASCRIPT
// ==========================================

const socket = io();

const $ = id => document.getElementById(id);

const params = new URLSearchParams(location.search);

const USER_NAME =
  localStorage.getItem("hukaName") ||
  localStorage.getItem("hukaUsername") ||
  "Huka User";

const SAVED_USER_ID =
  localStorage.getItem("hukaUserId") || "";

let currentUser = null;
let currentRoom = null;

let isOwner = false;
let isAdmin = false;

let localStream = null;
let micOn = false;
let speakerOn = true;
let joined = false;

let roomSeats = [];
let roomMembers = [];
let lockedSeats = [];

const peerConnections = new Map();
const remoteAudio = new Map();

const ICE_SERVERS = {
  iceServers: [
    {
      urls: "stun:stun.l.google.com:19302"
    }
  ]
};

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function showStatus(message) {
  if ($("roomStatus")) {
    $("roomStatus").textContent = message;
  }
}

function showVoiceStatus(message) {
  if ($("voiceStatus")) {
    $("voiceStatus").textContent = message;
  }
}

function showModal(id) {
  const modal = $(id);
  if (modal) modal.style.display = "flex";
}

function closeModal(id) {
  const modal = $(id);
  if (modal) modal.style.display = "none";
}

function escapeText(value) {
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

function emitWithCallback(event, data = {}) {
  return new Promise(resolve => {
    socket.timeout(10000).emit(
      event,
      data,
      (error, response) => {
        if (error) {
          resolve({
            ok: false,
            error: "Server response timeout."
          });
        } else {
          resolve(response || {
            ok: false,
            error: "No response from server."
          });
        }
      }
    );
  });
}

// ==========================================
// CONNECT AND REGISTER
// ==========================================

socket.on("connect", async () => {
  $("connectionStatus").textContent = "Online";

  const result = await emitWithCallback("register", {
    name: USER_NAME,
    profileId: SAVED_USER_ID
  });

  if (!result.ok) {
    showStatus(result.error || "Registration failed.");
    return;
  }

  currentUser = result.user;

  localStorage.setItem("hukaUserId", currentUser.id);
  localStorage.setItem("hukaName", currentUser.name);

  const roomId =
    params.get("room") ||
    localStorage.getItem("hukaMyRoom") ||
    "";

  if (!roomId) {
    showStatus("Room ID missing. Open a room from Home.");
    return;
  }

  await joinRoom(roomId);
});

socket.on("disconnect", () => {
  $("connectionStatus").textContent = "Disconnected";
  showStatus("Connection lost. Reconnecting...");
});

socket.on("connect_error", () => {
  $("connectionStatus").textContent = "Connection error";
});

// ==========================================
// JOIN ROOM
// ==========================================

async function joinRoom(roomId) {
  if (!currentUser) return;

  currentRoom = String(roomId);

  showStatus("Joining room...");

  const result = await emitWithCallback("join-room", {
    roomId: currentRoom
  });

  if (!result.ok) {
    showStatus(result.error || "Unable to join room.");
    return;
  }

  joined = true;

  $("roomId").textContent = result.room.id;
  $("roomName").textContent = result.room.name;
  $("roomOwner").textContent = result.room.owner;

  roomSeats = result.seats || [];
  roomMembers = result.members || [];

  renderSeats();
  renderMembers();

  if (result.messages) {
    result.messages.forEach(addMessage);
  }

  if (result.settings) {
    updateSettings(result.settings);
  }

  showStatus("You joined the room.");

  // Start with microphone OFF.
  micOn = false;

  socket.emit("mic-state", {
    micOn: false
  });

  updateMicButtons();

  socket.emit("get-gifts", result => {
    if (result?.ok) {
      renderGifts(result.gifts);
    }
  });

  $("adminPanel")?.classList.add("hidden");
}

// ==========================================
// ROOM MEMBERS
// ==========================================

function renderMembers() {
  const container = $("members");

  if (!container) return;

  container.innerHTML = "";

  $("memberCount").textContent = roomMembers.length;

  roomMembers.forEach(member => {
    const div = document.createElement("div");

    div.className = "member";

    const role = member.isOwner
      ? " 👑 Owner"
      : member.isAdmin
        ? " 🛡️ Admin"
        : "";

    const mic = member.micOn ? "🎤" : "🔇";

    div.textContent =
      `${member.name} ${mic}${role}`;

    container.appendChild(div);

    if (isAdmin &&
        member.id !== currentUser?.id &&
        member.id !== currentRoom?.ownerId) {

      const kickButton = document.createElement("button");

      kickButton.textContent = "Kick";
      kickButton.style.margin = "4px";

      kickButton.onclick = () => kickMember(member.id);

      container.appendChild(kickButton);
    }
  });

  const me = roomMembers.find(
    member => member.id === currentUser?.id
  );

  if (me) {
    isOwner = me.isOwner;
    isAdmin = me.isAdmin;

    $("adminPanel")?.classList.toggle(
      "hidden",
      !isAdmin
    );

    $("clearChatButton")?.classList.toggle(
      "hidden",
      !isAdmin
    );
  }
}

socket.on("members-update", data => {
  roomMembers = data.members || [];
  renderMembers();
});

// ==========================================
// SEATS
// ==========================================

function renderSeats() {
  const container = $("seats");

  if (!container) return;

  container.innerHTML = "";

  roomSeats.forEach((seat, index) => {
    const button = document.createElement("button");

    button.className = "seat";

    const locked = lockedSeats.includes(index);

    if (locked) button.classList.add("locked");

    if (seat) {
      button.innerHTML =
        `<strong>${escapeText(seat.name)}</strong>
         <small>Seat ${index + 1}</small>`;
    } else if (locked) {
      button.innerHTML =
        `🔒 Locked<small>Seat ${index + 1}</small>`;
    } else {
      button.innerHTML =
        `🎙️ Empty<small>Seat ${index + 1}</small>`;
    }

    button.onclick = () => {
      if (seat) {
        if (seat.id === currentUser?.id) {
          leaveSeat();
        } else {
          showStatus("This seat is already occupied.");
        }
      } else {
        takeSeat(index);
      }
    };

    container.appendChild(button);
  });
}

async function takeSeat(index) {
  const result = await emitWithCallback(
    "take-seat",
    index
  );

  if (!result.ok) {
    showStatus(result.error);
    return;
  }

  showStatus("You took seat " + (index + 1));
}

async function leaveSeat() {
  const result = await emitWithCallback("leave-seat");

  if (result.ok) {
    showStatus("You left your seat.");
  } else {
    showStatus(result.error);
  }
}

socket.on("seats-update", seats => {
  roomSeats = seats || [];
  renderSeats();
});

socket.on("locked-seats-update", seats => {
  lockedSeats = seats || [];
  renderSeats();
});

// ==========================================
// CHANGE SEAT COUNT
// ==========================================

async function changeSeatCount(count) {
  if (!isOwner) {
    showStatus("Only Room Owner can change seats.");
    return;
  }

  const result = await emitWithCallback(
    "update-room-settings",
    { seats: count }
  );

  if (!result.ok) {
    showStatus(result.error);
    return;
  }

  showStatus(count + " seats selected.");
}

// ==========================================
// MIC CONTROL
// ==========================================

async function toggleMic() {
  if (!joined) return;

  if (!micOn) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });

      localStream.getAudioTracks().forEach(track => {
        track.enabled = true;
      });

      micOn = true;

      // Add microphone to all existing connections.
      for (const [peerId, pc] of peerConnections) {
        addLocalTracks(pc);

        if (pc.signalingState === "stable") {
          await makeOffer(peerId);
        }
      }

      showVoiceStatus("Microphone connected.");
    } catch (error) {
      micOn = false;

      showVoiceStatus(
        "Microphone permission denied or unavailable."
      );

      updateMicButtons();
      return;
    }
  } else {
    micOn = false;

    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = false;
      });
    }

    showVoiceStatus("Microphone OFF.");
  }

  socket.emit("mic-state", {
    micOn
  });

  updateMicButtons();
}

function updateMicButtons() {
  const text = micOn ? "🎤 Mic ON" : "🔇 Mic OFF";

  if ($("micButton")) {
    $("micButton").textContent = text;
  }

  if ($("bottomMicButton")) {
    $("bottomMicButton").textContent =
      micOn ? "🎤 ON" : "🔇 OFF";
  }
}

socket.on("force-mute", data => {
  if (data?.muted) {
    micOn = false;

    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = false;
      });
    }

    updateMicButtons();

    showVoiceStatus("Admin muted your microphone.");
  }
});

// ==========================================
// SPEAKER
// ==========================================

function toggleSpeaker() {
  speakerOn = !speakerOn;

  remoteAudio.forEach(audio => {
    audio.muted = !speakerOn;
  });

  if ($("speakerButton")) {
    $("speakerButton").textContent =
      speakerOn ? "🔊 Speaker" : "🔇 Speaker";
  }
}

// ==========================================
// WEBRTC VOICE CHAT
// ==========================================

function addLocalTracks(pc) {
  if (!localStream) return;

  const existingTracks = pc.getSenders()
    .map(sender => sender.track?.id)
    .filter(Boolean);

  localStream.getTracks().forEach(track => {
    if (!existingTracks.includes(track.id)) {
      pc.addTrack(track, localStream);
    }
  });
}

function createPeer(peerId) {
  if (peerConnections.has(peerId)) {
    return peerConnections.get(peerId);
  }

  const pc = new RTCPeerConnection(ICE_SERVERS);

  peerConnections.set(peerId, pc);

  addLocalTracks(pc);

  pc.onicecandidate = event => {
    if (event.candidate) {
      socket.emit("voice-ice", {
        to: peerId,
        candidate: event.candidate
      });
    }
  };

  pc.ontrack = event => {
    let audio = remoteAudio.get(peerId);

    if (!audio) {
      audio = document.createElement("audio");

      audio.autoplay = true;
      audio.playsInline = true;
      audio.muted = !speakerOn;

      document.body.appendChild(audio);

      remoteAudio.set(peerId, audio);
    }

    audio.srcObject = event.streams[0];

    audio.play().catch(() => {
      showVoiceStatus("Tap Speaker to enable audio.");
    });

    showVoiceStatus("Voice connected.");
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

async function makeOffer(peerId) {
  try {
    const pc = createPeer(peerId);

    if (pc.signalingState !== "stable") return;

    addLocalTracks(pc);

    const offer = await pc.createOffer();

    await pc.setLocalDescription(offer);

    socket.emit("voice-offer", {
      to: peerId,
      offer: pc.localDescription
    });
  } catch (error) {
    console.error("Voice offer error:", error);
  }
}

// Existing members receive this when a new member joins.
// Existing member creates the offer.
socket.on("voice-peer-joined", async data => {
  if (!data?.socketId) return;

  await makeOffer(data.socketId);
});

// New member receives existing peer IDs.
// It waits for their offers.
socket.on("voice-existing-peers", peers => {
  (peers || []).forEach(peerId => {
    createPeer(peerId);
  });
});

// Receive voice offer.
socket.on("voice-offer", async data => {
  try {
    const pc = createPeer(data.from);

    await pc.setRemoteDescription(
      new RTCSessionDescription(data.offer)
    );

    const answer = await pc.createAnswer();

    await pc.setLocalDescription(answer);

    socket.emit("voice-answer", {
      to: data.from,
      answer: pc.localDescription
    });
  } catch (error) {
    console.error("Voice answer error:", error);
  }
});

// Receive voice answer.
socket.on("voice-answer", async data => {
  try {
    const pc = peerConnections.get(data.from);

    if (!pc) return;

    await pc.setRemoteDescription(
      new RTCSessionDescription(data.answer)
    );
  } catch (error) {
    console.error("Voice answer receive error:", error);
  }
});

// ICE candidates.
socket.on("voice-ice", async data => {
  try {
    const pc = peerConnections.get(data.from);

    if (!pc || !data.candidate) return;

    await pc.addIceCandidate(
      new RTCIceCandidate(data.candidate)
    );
  } catch (error) {
    console.error("ICE error:", error);
  }
});

function removePeer(peerId) {
  const pc = peerConnections.get(peerId);

  if (pc) {
    pc.close();
    peerConnections.delete(peerId);
  }

  const audio = remoteAudio.get(peerId);

  if (audio) {
    audio.srcObject = null;
    audio.remove();

    remoteAudio.delete(peerId);
  }
}

socket.on("voice-peer-left", data => {
  if (data?.socketId) {
    removePeer(data.socketId);
  }
});

// ==========================================
// ROOM CHAT
// ==========================================

function addMessage(message) {
  const container = $("chatMessages");

  if (!container) return;

  const div = document.createElement("div");

  div.style.padding = "7px";
  div.style.marginBottom = "5px";
  div.style.borderRadius = "8px";
  div.style.background = "#352149";

  const name = document.createElement("strong");
  name.textContent = message.name + ": ";

  const text = document.createElement("span");
  text.textContent = message.text;

  div.appendChild(name);
  div.appendChild(text);

  container.appendChild(div);

  container.scrollTop = container.scrollHeight;
}

function sendMessage() {
  const input = $("chatInput");

  const text = input?.value.trim();

  if (!text || !joined) return;

  socket.emit("room-message", {
    text
  });

  input.value = "";
}

$("chatInput")?.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    sendMessage();
  }
});

socket.on("room-message", addMessage);

socket.on("system-message", message => {
  addMessage({
    name: "Huka System",
    text: message
  });
});

// ==========================================
// CLEAR CHAT
// ==========================================

async function clearChat() {
  if (!isAdmin) {
    showStatus("Permission denied.");
    return;
  }

  if (!confirm("Clear all room messages?")) {
    return;
  }

  const result = await emitWithCallback("clear-chat");

  if (!result.ok) {
    showStatus(result.error);
  }
}

socket.on("chat-cleared", data => {
  $("chatMessages").innerHTML = "";

  addMessage({
    name: "Huka System",
    text: "Chat cleared by " + data.by
  });
});

// ==========================================
// MENTION
// ==========================================

function mentionUser() {
  if (!roomMembers.length) return;

  const names = roomMembers
    .map(member => member.name)
    .join(", ");

  const selected = prompt(
    "Enter username to mention:\n" + names
  );

  if (!selected) return;

  const input = $("chatInput");

  if (input) {
    input.value += "@" + selected + " ";
    input.focus();
  }
}

// ==========================================
// EMOJI
// ==========================================

function openEmoji() {
  showModal("emojiModal");
}

function sendEmoji(emoji) {
  socket.emit("send-emoji", {
    emoji
  });

  closeModal("emojiModal");
}

socket.on("emoji-event", data => {
  const div = document.createElement("div");

  div.textContent =
    `${data.name}: ${data.emoji}`;

  div.style.fontSize = "24px";
  div.style.textAlign = "center";
  div.style.padding = "5px";

  $("chatMessages")?.appendChild(div);
});

// ==========================================
// GIFTS
// ==========================================

function openGifts() {
  showModal("giftModal");
}

function renderGifts(gifts) {
  const container = $("giftList");

  if (!container) return;

  container.innerHTML = "";

  Object.entries(gifts || {}).forEach(([name, cost]) => {
    const button = document.createElement("button");

    button.textContent = `${name} 💎 ${cost}`;

    button.onclick = () => sendGift(name);

    container.appendChild(button);
  });
}

async function sendGift(gift) {
  const receiver =
    $("giftReceiver")?.value.trim() || "Everyone";

  const result = await emitWithCallback(
    "send-gift",
    {
      gift,
      to: receiver
    }
  );

  if (!result.ok) {
    alert(result.error || "Gift failed.");
    return;
  }

  closeModal("giftModal");

  showStatus(
    "Gift sent! Remaining coins: " + result.coins
  );
}

socket.on("gift-event", data => {
  addMessage({
    name: "🎁 Gift",
    text:
      `${data.from} sent ${data.gift} to ${data.to}`
  });
});

// ==========================================
// GIFT RANKING
// ==========================================

socket.on("gift-ranking", ranking => {
  const container = $("giftRanking");

  if (!container) return;

  container.innerHTML = "";

  if (!ranking || ranking.length === 0) {
    container.textContent = "No gifts yet.";
    return;
  }

  ranking.forEach((item, index) => {
    const div = document.createElement("div");

    div.style.padding = "8px";

    div.textContent =
      `${index + 1}. ${item.name} — ` +
      `${item.gifts} Gifts — ${item.coins} Coins`;

    container.appendChild(div);
  });
});

// ==========================================
// INBOX
// ==========================================

function openInbox() {
  socket.emit("get-inbox");
  showModal("inboxModal");
}

socket.on("inbox-data", messages => {
  const container = $("inboxMessages");

  if (!container) return;

  container.innerHTML = "";

  if (!messages.length) {
    container.textContent = "Inbox is empty.";
    return;
  }

  messages.forEach(message => {
    const div = document.createElement("div");

    div.style.padding = "10px";
    div.style.marginBottom = "7px";
    div.style.background = "#412b58";
    div.style.borderRadius = "8px";

    div.textContent =
      `${message.from}: ${message.text}`;

    container.appendChild(div);
  });
});

socket.on("new-dm", message => {
  showStatus("New message from " + message.from);
});

socket.on("dm-error", message => {
  alert(message);
});

// ==========================================
// YOUTUBE SHARING
// ==========================================

async function shareYoutube() {
  const input = $("youtubeInput");

  const url = input?.value.trim();

  if (!url) {
    alert("Enter YouTube link.");
    return;
  }

  const result = await emitWithCallback(
    "share-youtube",
    { url }
  );

  if (!result.ok) {
    alert(result.error);
    return;
  }

  input.value = "";
}

socket.on("youtube-link", data => {
  const container = $("youtubeLinks");

  if (!container) return;

  const link = document.createElement("a");

  link.href = data.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  link.textContent =
    "▶ YouTube shared by " + data.by;

  link.style.display = "block";
  link.style.padding = "10px";
  link.style.color = "#ff8bd7";

  container.appendChild(link);
});

// ==========================================
// ROOM SETTINGS
// ==========================================

function updateSettings(settings) {
  if (!settings) return;

  $("settingRoomName").value =
    $("roomName").textContent;

  $("settingDescription").value =
    settings.description || "";

  $("roomLocked").checked =
    Boolean(settings.locked);

  $("youtubeAllowed").checked =
    settings.allowYoutube !== false;
}

socket.on("room-settings-update", settings => {
  updateSettings(settings);

  if (settings.name) {
    $("roomName").textContent = settings.name;
  }
});

async function saveRoomSettings() {
  if (!isAdmin) {
    showStatus("Permission denied.");
    return;
  }

  const data = {
    name: $("settingRoomName").value,
    description: $("settingDescription").value,
    allowYoutube: $("youtubeAllowed").checked
  };

  if (isOwner) {
    data.locked = $("roomLocked").checked;
  }

  const result = await emitWithCallback(
    "update-room-settings",
    data
  );

  if (!result.ok) {
    showStatus(result.error);
    return;
  }

  showStatus("Room settings saved.");
}

// ==========================================
// ADMIN CONTROLS
// ==========================================

async function kickMember(userId) {
  if (!isAdmin) return;

  if (!confirm("Remove this member from room?")) {
    return;
  }

  const result = await emitWithCallback(
    "kick-member",
    { userId }
  );

  if (!result.ok) {
    alert(result.error);
  }
}

async function addAdmin(userId) {
  if (!isOwner) return;

  const result = await emitWithCallback(
    "add-room-admin",
    { userId }
  );

  if (!result.ok) alert(result.error);
}

async function removeAdmin(userId) {
  if (!isOwner) return;

  const result = await emitWithCallback(
    "remove-room-admin",
    { userId }
  );

  if (!result.ok) alert(result.error);
}

async function forceMute(userId) {
  if (!isAdmin) return;

  const result = await emitWithCallback(
    "force-mute",
    { userId }
  );

  if (!result.ok) alert(result.error);
}

// ==========================================
// ROOM ADMIN UPDATES
// ==========================================

socket.on("room-admins-update", admins => {
  roomMembers = roomMembers.map(member => ({
    ...member,
    isAdmin: admins.includes(member.id) ||
      member.isOwner
  }));

  renderMembers();
});

// ==========================================
// LEAVE ROOM
// ==========================================

function leaveRoom() {
  if (!confirm("Are you sure you want to leave?")) {
    return;
  }

  socket.emit("leave-room");

  cleanupVoice();

  joined = false;

  location.href = "index.html";
}

function cleanupVoice() {
  peerConnections.forEach((pc, peerId) => {
    pc.close();
  });

  peerConnections.clear();

  remoteAudio.forEach(audio => {
    audio.srcObject = null;
    audio.remove();
  });

  remoteAudio.clear();

  if (localStream) {
    localStream.getTracks().forEach(track => {
      track.stop();
    });

    localStream = null;
  }
}

socket.on("kicked-from-room", data => {
  alert(data.message || "You were removed from room.");

  cleanupVoice();

  joined = false;

  location.href = "index.html";
});

// ==========================================
// PROFILE UPDATE
// ==========================================

socket.on("profile-update", profile => {
  currentUser = {
    ...currentUser,
    ...profile
  };

  localStorage.setItem("hukaUserId", profile.id);
});

// ==========================================
// ROOM CLOSE / PAGE EXIT
// ==========================================

window.addEventListener("beforeunload", () => {
  cleanupVoice();
});

window.addEventListener("offline", () => {
  showStatus("Internet connection lost.");
});

window.addEventListener("online", () => {
  showStatus("Internet connection restored.");
});

// ==========================================
// INITIAL STATE
// ==========================================

updateMicButtons();

console.log("Huka Voice Chat Room JS loaded.");
