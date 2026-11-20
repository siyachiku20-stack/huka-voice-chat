"use strict";

/* =========================================
   HUKA VOICE CHAT
   ROOM JAVASCRIPT
========================================= */

const socket = io();

const $ = id => document.getElementById(id);

const params = new URLSearchParams(location.search);

let roomId =
  params.get("roomId") ||
  localStorage.getItem("hukaRoomId") ||
  "";

let userId = localStorage.getItem("hukaUserId") || "";
let userName = localStorage.getItem("hukaUserName") || "Huka User";

let currentRoom = null;
let currentUser = null;
let members = [];
let seats = [];
let gifts = [];
let giftCategories = ["All", "Lucky", "VIP", "Love", "Royal", "Festival", "Special"];
let selectedGift = null;
let selectedReceiver = "Everyone";
let giftFilter = "All";
let roomSettings = {};
let giftRanking = [];
let inboxMessages = [];
let activeProfile = null;
let isAdmin = false;
let micOn = false;
let speakerOn = true;
let localStream = null;

const peerConnections = new Map();

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

/* =========================================
   HELPERS
========================================= */

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function toast(message) {
  const element = $("toast");

  if (element) {
    element.textContent = message;
    element.classList.remove("hidden");

    clearTimeout(toast.timer);

    toast.timer = setTimeout(() => {
      element.classList.add("hidden");
    }, 2800);
  } else {
    console.log(message);
  }
}

function emitReply(event, data = {}, timeout = 10000) {
  return new Promise(resolve => {
    let completed = false;

    const timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        resolve({
          ok: false,
          message: "Server response timeout"
        });
      }
    }, timeout);

    socket.emit(event, data, response => {
      if (completed) return;

      completed = true;
      clearTimeout(timer);

      resolve(response || {
        ok: false,
        message: "No response from server"
      });
    });
  });
}

function showModal(id) {
  const element = $(id);
  if (element) element.classList.remove("hidden");
}

function hideModal(id) {
  const element = $(id);
  if (element) element.classList.add("hidden");
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value ?? "";
}

function setHTML(id, value) {
  const element = $(id);
  if (element) element.innerHTML = value;
}

function formatTime(time) {
  return new Date(time || Date.now()).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getAvatar(user) {
  if (user?.avatar) {
    return `<img src="${escapeHTML(user.avatar)}" alt="DP">`;
  }

  return `<span class="default-avatar">👤</span>`;
}

function updateCoins(coins) {
  if (!currentUser) return;

  currentUser.coins = Number(coins) || 0;

  setText("giftCoins", currentUser.coins);
  setText("profileCoins", currentUser.coins);

  localStorage.setItem(
    "hukaCoins",
    String(currentUser.coins)
  );
}

function updateProfileData(profile) {
  if (!profile) return;

  currentUser = {
    ...(currentUser || {}),
    ...profile
  };

  if (profile.id) {
    userId = String(profile.id);
    localStorage.setItem("hukaUserId", userId);
  }

  if (profile.name) {
    userName = profile.name;
    localStorage.setItem("hukaUserName", userName);
  }

  if (profile.coins !== undefined) {
    updateCoins(profile.coins);
  }

  if ($("profileName")) {
    $("profileName").textContent = profile.name || userName;
  }

  if ($("profileDP") && profile.avatar) {
    $("profileDP").src = profile.avatar;
  }
}

/* =========================================
   REGISTER
========================================= */

async function registerUser() {
  const result = await emitReply("register", {
    name: userName,
    profileId: userId
  });

  if (!result.ok) {
    toast(result.message || "Registration failed");
    return false;
  }

  currentUser = result.user;

  userId = String(result.user.id);
  userName = result.user.name;

  localStorage.setItem("hukaUserId", userId);
  localStorage.setItem("hukaUserName", userName);

  updateProfileData(result.user);

  return true;
}

/* =========================================
   JOIN ROOM
========================================= */

async function joinRoom() {
  if (!roomId) {
    toast("Room ID missing");
    return;
  }

  const result = await emitReply("join-room", {
    roomId
  });

  if (!result.ok) {
    toast(result.message || "Could not join room");
    return;
  }

  currentRoom = result.room;
  members = result.members || [];
  seats = result.seats || [];
  roomSettings = result.settings || {};

  setText("roomName", currentRoom.name);
  setText("roomId", currentRoom.id);
  setText("memberCount", members.length);
  setText("membersTotal", members.length);

  renderMembers();
  renderSeats();
  renderMessages(result.messages || []);

  await loadGifts();
  await loadInbox();
  await loadProfile();

  socket.emit("get-rooms");

  toast("Room joined successfully");
}

/* =========================================
   ROOM MEMBERS
========================================= */

function renderMembers() {
  setText("memberCount", members.length);
  setText("membersTotal", members.length);

  const list = $("membersList");
  if (!list) return;

  list.innerHTML = members.map(member => `
    <div class="member-item" data-user-id="${escapeHTML(member.id)}">
      <div class="member-avatar">
        ${getAvatar(member)}
      </div>

      <div class="member-info">
        <strong>${escapeHTML(member.name)}</strong>
        <small>
          ${member.isOwner ? "👑 Owner" : member.isAdmin ? "🛡 Admin" : "Online"}
        </small>
      </div>

      <button class="member-profile-button"
        data-profile-id="${escapeHTML(member.id)}">
        Profile
      </button>
    </div>
  `).join("");
}

/* =========================================
   SEATS
========================================= */

function renderSeats() {
  const vip = $("vipSeats");
  const normal = $("normalSeats");

  if (!vip && !normal) return;

  const html = seats.map((seat, index) => {
    if (!seat) {
      return `
        <button class="seat empty-seat"
          data-seat="${index + 1}">
          <span>＋</span>
          <small>Seat ${index + 1}</small>
        </button>
      `;
    }

    const member = members.find(
      item => item.socketId === seat.socketId
    );

    return `
      <button class="seat occupied-seat"
        data-profile-id="${escapeHTML(seat.userId || seat.id)}">
        <span>${escapeHTML(seat.name || member?.name || "User")}</span>
        <small>🎙 Seat ${index + 1}</small>
      </button>
    `;
  });

  if (vip) {
    vip.innerHTML = html.slice(0, 5).join("");
  }

  if (normal) {
    normal.innerHTML = html.slice(5).join("");
  }
}

/* =========================================
   TAKE SEAT
========================================= */

async function takeSeat(number) {
  const result = await emitReply("take-seat", {
    seat: Number(number)
  });

  if (!result.ok) {
    toast(result.message || "Could not take seat");
    return;
  }

  toast("Seat joined");
}

async function leaveSeat() {
  const result = await emitReply("leave-seat");

  if (result.ok) {
    toast("You left the seat");
  } else {
    toast(result.message || "Could not leave seat");
  }
}

/* =========================================
   CHAT
========================================= */

function addMessage(message) {
  const container = $("chatMessages");
  if (!container) return;

  const div = document.createElement("div");
  div.className = "chat-message";

  div.innerHTML = `
    <strong>${escapeHTML(message.username || message.name || "User")}</strong>
    <span>${escapeHTML(message.message || message.text || "")}</span>
    <small>${formatTime(message.time)}</small>
  `;

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function renderMessages(messages) {
  const container = $("chatMessages");
  if (!container) return;

  container.innerHTML = "";

  messages.forEach(addMessage);
}

async function sendMessage(event) {
  if (event) event.preventDefault();

  const input = $("chatInput");
  if (!input) return;

  const message = input.value.trim();

  if (!message) return;

  const result = await emitReply("room-message", {
    text: message
  });

  if (!result.ok) {
    toast(result.message || "Message not sent");
    return;
  }

  input.value = "";
}

function clearChat() {
  if (!confirm("Clear all room messages?")) return;

  emitReply("clear-chat").then(result => {
    toast(result.message || (
      result.ok ? "Chat cleared" : "Permission denied"
    ));
  });
}

/* =========================================
   EMOJI
========================================= */

function sendEmoji(emoji) {
  socket.emit("send-emoji", { emoji }, result => {
    if (!result?.ok) {
      toast(result?.message || "Emoji not sent");
    }
  });
}

function toggleEmojiPanel() {
  const panel = $("emojiPanel");
  if (!panel) return;

  panel.classList.toggle("hidden");
}

/* =========================================
   GIFTS - 500 GIFTS
========================================= */

async function loadGifts() {
  const result = await emitReply("get-gifts");

  if (!result.ok) {
    toast(result.message || "Could not load gifts");
    return;
  }

  gifts = Array.isArray(result.gifts) ? result.gifts : [];

  if (Array.isArray(result.categories)) {
    giftCategories = result.categories;
  }

  renderGiftCategories();
  renderGiftList();
}

function renderGiftCategories() {
  const container = $("giftCategories");
  if (!container) return;

  container.innerHTML = giftCategories.map(category => `
    <button
      class="${giftFilter === category ? "active" : ""}"
      data-gift-category="${escapeHTML(category)}">
      ${escapeHTML(category)}
    </button>
  `).join("");
}

function renderGiftList() {
  const container = $("giftList");
  if (!container) return;

  const search = $("giftSearch")?.value?.toLowerCase() || "";

  const filtered = gifts.filter(gift => {
    const categoryMatch =
      giftFilter === "All" || gift.category === giftFilter;

    const searchMatch =
      gift.name.toLowerCase().includes(search);

    return categoryMatch && searchMatch;
  });

  container.innerHTML = filtered.map(gift => `
    <button class="gift-item ${
      selectedGift?.id === gift.id ? "selected" : ""
    }" data-gift-id="${escapeHTML(gift.id)}">

      <span class="gift-icon">${escapeHTML(gift.icon)}</span>

      <strong>${escapeHTML(gift.name)}</strong>

      <small>🪙 ${Number(gift.price).toLocaleString("en-IN")}</small>
    </button>
  `).join("");

  if (!filtered.length) {
    container.innerHTML = "<p>No gifts found</p>";
  }
}

function selectGift(giftId) {
  selectedGift = gifts.find(gift => gift.id === giftId);

  if (!selectedGift) return;

  setText(
    "selectedGiftInfo",
    `${selectedGift.icon} ${selectedGift.name} - ${selectedGift.price} Coins`
  );

  renderGiftList();
}

function openGiftModal(receiverId = "Everyone") {
  selectedReceiver = receiverId || "Everyone";
  selectedGift = null;

  setText("giftReceiver", selectedReceiver);

  showModal("giftModal");

  loadGifts();
}

async function sendGift() {
  if (!selectedGift) {
    toast("Select a gift first");
    return;
  }

  const quantity = Math.max(
    1,
    Math.min(10, Number($("giftQuantity")?.value || 1))
  );

  const result = await emitReply("send-gift", {
    giftId: selectedGift.id,
    receiverId: selectedReceiver,
    quantity
  });

  if (!result.ok) {
    toast(result.message || "Gift could not be sent");
    return;
  }

  updateCoins(result.coins);

  toast("Gift sent successfully");

  selectedGift = null;
  hideModal("giftModal");
}

/* =========================================
   GIFT EVENTS
========================================= */

function showGiftEvent(event) {
  const name = event.giftName || event.gift || "Gift";
  const icon = event.giftIcon || "🎁";
  const sender = event.senderName || event.from || "User";
  const receiver = event.receiverName || event.to || "Everyone";

  const text = `${icon} ${sender} sent ${name} to ${receiver}`;

  const notification = $("giftNotification");

  if (notification) {
    notification.textContent = text;
    notification.classList.remove("hidden");

    clearTimeout(showGiftEvent.timer);

    showGiftEvent.timer = setTimeout(() => {
      notification.classList.add("hidden");
    }, 4000);
  }

  addMessage({
    username: "🎁 Gift",
    message: text,
    time: event.time
  });
}

/* =========================================
   GIFT RANKING
========================================= */

function renderGiftRanking(ranking = []) {
  giftRanking = ranking;

  const container = $("giftRanking");
  if (!container) return;

  container.innerHTML = ranking.map((item, index) => `
    <div class="ranking-item">
      <strong>#${index + 1}</strong>
      <span>${escapeHTML(item.name || "User")}</span>
      <b>🪙 ${Number(item.coins || 0).toLocaleString("en-IN")}</b>
    </div>
  `).join("");
}

/* =========================================
   USER PROFILE
========================================= */

async function loadProfile() {
  const result = await emitReply("get-profile");

  if (result.ok && result.profile) {
    updateProfileData(result.profile);
  }
}

async function openUserProfile(targetId) {
  if (!targetId) return;

  const result = await emitReply("get-profile", {
    userId: targetId
  });

  if (!result.ok || !result.profile) {
    toast("Profile not found");
    return;
  }

  activeProfile = result.profile;

  const profile = result.profile;

  setText("popupUserName", profile.name || "User");
  setText("popupUserId", profile.id || targetId);
  setText("popupUserLevel", profile.level || 1);
  setText("popupUserCountry", profile.country || "Not set");

  const dp = $("popupUserDP");

  if (dp) {
    if (profile.avatar) {
      dp.src = profile.avatar;
      dp.style.display = "block";
    } else {
      dp.removeAttribute("src");
      dp.style.display = "none";
    }
  }

  setText("popupUserBio", profile.bio || "No bio");

  const followButton = $("followUserButton");

  if (followButton) {
    const following = currentUser?.following || [];

    followButton.textContent =
      following.includes(targetId) ? "Following" : "Follow";
  }

  showModal("userProfileModal");
}

async function saveProfile() {
  const name = $("editProfileName")?.value;
  const bio = $("editProfileBio")?.value;
  const avatar = $("editProfileAvatar")?.value;
  const country = $("editProfileCountry")?.value;
  const gender = $("editProfileGender")?.value;

  const result = await emitReply("profile-update", {
    name,
    bio,
    avatar,
    country,
    gender
  });

  if (!result.ok) {
    toast(result.message || "Profile update failed");
    return;
  }

  updateProfileData(result.profile);

  toast("Profile updated");
}

async function followUser() {
  if (!activeProfile) return;

  const result = await emitReply("follow-user", {
    userId: activeProfile.id
  });

  if (!result.ok) {
    toast(result.message || "Could not follow user");
    return;
  }

  currentUser.following ||= [];

  if (result.following) {
    if (!currentUser.following.includes(activeProfile.id)) {
      currentUser.following.push(activeProfile.id);
    }
  } else {
    currentUser.following =
      currentUser.following.filter(id => id !== activeProfile.id);
  }

  setText(
    "followUserButton",
    result.following ? "Following" : "Follow"
  );

  toast(result.following ? "Following user" : "Unfollowed");
}

/* =========================================
   PROFILE CHAT / GIFT
========================================= */

async function chatWithProfile() {
  if (!activeProfile) return;

  const text = prompt(
    `Message to ${activeProfile.name}:`
  );

  if (!text?.trim()) return;

  const result = await emitReply("send-dm", {
    to: activeProfile.id,
    text: text.trim()
  });

  toast(result.ok ? "Message sent" : result.message);
}

function giftToProfile() {
  if (!activeProfile) return;

  hideModal("userProfileModal");
  openGiftModal(activeProfile.id);
}

/* =========================================
   BAG / FRAMES
========================================= */

async function openBag() {
  const result = await emitReply("get-frames");

  if (!result.ok) {
    toast(result.message || "Could not load bag");
    return;
  }

  const container = $("bagFrames");

  if (container) {
    container.innerHTML = result.frames.map(frame => {
      const owned = result.ownedFrames.includes(frame.id);
      const active = result.activeFrame === frame.id;

      return `
        <div class="frame-item">
          <span>${escapeHTML(frame.icon)}</span>
          <strong>${escapeHTML(frame.name)}</strong>
          <small>${frame.free ? "FREE" : `🪙 ${frame.price}`}</small>

          ${
            active
              ? "<button disabled>Selected</button>"
              : owned
                ? `<button data-equip-frame="${escapeHTML(frame.id)}">Use</button>`
                : `<button data-buy-frame="${escapeHTML(frame.id)}">Buy</button>`
          }
        </div>
      `;
    }).join("");
  }

  showModal("bagModal");
}

async function buyFrame(frameId) {
  const result = await emitReply("buy-frame", {
    frameId
  });

  if (!result.ok) {
    toast(result.message || "Could not buy frame");
    return;
  }

  updateCoins(result.coins);

  toast("Frame purchased");

  openBag();
}

async function equipFrame(frameId) {
  const result = await emitReply("equip-frame", {
    frameId
  });

  if (!result.ok) {
    toast(result.message || "Could not select frame");
    return;
  }

  if (currentUser) {
    currentUser.frame = frameId;
  }

  toast("Frame selected");

  openBag();
}

/* =========================================
   ROOM TASKS
========================================= */

async function openRoomTasks() {
  const result = await emitReply("get-room-tasks");

  if (!result.ok) {
    toast(result.message || "Could not load tasks");
    return;
  }

  const container = $("roomTasksList");

  if (container) {
    container.innerHTML = result.tasks.map(task => `
      <div class="task-item">
        <div>
          <strong>${escapeHTML(task.name)}</strong>
          <p>${escapeHTML(task.description)}</p>
          <small>Reward: 🪙 ${task.reward}</small>
        </div>

        ${
          task.claimed
            ? "<button disabled>Claimed</button>"
            : task.completed
              ? `<button data-claim-task="${escapeHTML(task.id)}">Claim</button>`
              : "<button disabled>Not completed</button>"
        }
      </div>
    `).join("");
  }

  setText("taskCoins", result.coins);
  setText("taskTotalRewards", result.totalRewards);

  showModal("roomTasksModal");
}

async function claimRoomTask(taskId) {
  const result = await emitReply("claim-room-task", {
    taskId
  });

  if (!result.ok) {
    toast(result.message || "Could not claim reward");
    return;
  }

  updateCoins(result.coins);

  toast(`You received ${result.reward} coins`);

  openRoomTasks();
}

/* =========================================
   INBOX
========================================= */

async function loadInbox() {
  const result = await emitReply("get-inbox");

  if (result.ok) {
    inboxMessages = result.messages || [];
    renderInbox();
  }
}

function renderInbox() {
  const container = $("inboxMessages");
  if (!container) return;

  container.innerHTML = inboxMessages.map(message => `
    <div class="inbox-message">
      <strong>${escapeHTML(message.from || "User")}</strong>
      <p>${escapeHTML(message.text || message.message || "")}</p>
      <small>${formatTime(message.time)}</small>
    </div>
  `).join("");
}

function openInbox() {
  loadInbox();
  showModal("inboxModal");
}

/* =========================================
   YOUTUBE
========================================= */

async function shareYoutube() {
  const input = $("youtubeInput");

  if (!input?.value.trim()) {
    toast("Enter YouTube link");
    return;
  }

  const result = await emitReply("share-youtube", {
    url: input.value.trim()
  });

  if (!result.ok) {
    toast(result.message || "Could not share link");
    return;
  }

  input.value = "";

  toast("YouTube link shared");

  hideModal("youtubeModal");
}

function addYoutubeLink(event) {
  const container = $("youtubeLinks");
  if (!container) return;

  const link = document.createElement("a");

  link.href = event.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = `▶ YouTube shared by ${event.by || event.username}`;

  container.appendChild(link);
}

/* =========================================
   ROOM SETTINGS
========================================= */

async function saveRoomSettings() {
  const result = await emitReply("update-room-settings", {
    name: $("settingRoomName")?.value,
    description: $("settingDescription")?.value,
    locked: $("settingLocked")?.checked,
    allowYoutube: $("settingYoutube")?.checked
  });

  if (!result.ok) {
    toast(result.message || "Settings update failed");
    return;
  }

  toast("Room settings saved");

  hideModal("settingsModal");
}

/* =========================================
   ADMIN
========================================= */

async function addAdmin() {
  const userId = $("adminUserId")?.value.trim();

  if (!userId) {
    toast("Enter User ID");
    return;
  }

  const result = await emitReply("add-room-admin", {
    userId
  });

  toast(result.message || (
    result.ok ? "Admin added" : "Could not add admin"
  ));
}

async function removeAdmin() {
  const userId = $("adminUserId")?.value.trim();

  const result = await emitReply("remove-room-admin", {
    userId
  });

  toast(result.message || (
    result.ok ? "Admin removed" : "Could not remove admin"
  ));
}

async function kickMember() {
  const userId = $("adminUserId")?.value.trim();

  const result = await emitReply("kick-member", {
    userId
  });

  toast(result.message || (
    result.ok ? "Member removed" : "Could not remove member"
  ));
}

async function muteMember() {
  const userId = $("adminUserId")?.value.trim();

  const result = await emitReply("force-mute", {
    userId
  });

  toast(result.message || (
    result.ok ? "Member muted" : "Could not mute member"
  ));
}

/* =========================================
   MIC
========================================= */

async function toggleMic() {
  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
    } catch (error) {
      toast("Microphone permission required");
      return;
    }
  }

  micOn = !micOn;

  localStream.getAudioTracks().forEach(track => {
    track.enabled = micOn;
  });

  socket.emit("mic-state", {
    micOn
  });

  const button = $("micButton");

  if (button) {
    button.textContent = micOn ? "🎙️" : "🔇";
    button.classList.toggle("active", micOn);
  }
}

function toggleSpeaker() {
  speakerOn = !speakerOn;

  document.querySelectorAll("audio").forEach(audio => {
    audio.muted = !speakerOn;
  });

  const button = $("speakerButton");

  if (button) {
    button.textContent = speakerOn ? "🔊" : "🔈";
  }
}

/* =========================================
   WEBRTC VOICE
========================================= */

function createPeerConnection(targetId) {
  if (peerConnections.has(targetId)) {
    return peerConnections.get(targetId);
  }

  const peer = new RTCPeerConnection(ICE_SERVERS);

  if (localStream) {
    localStream.getTracks().forEach(track => {
      peer.addTrack(track, localStream);
    });
  }

  peer.onicecandidate = event => {
    if (event.candidate) {
      socket.emit("voice-ice", {
        to: targetId,
        candidate: event.candidate
      });
    }
  };

  peer.ontrack = event => {
    let audio = document.getElementById(`audio-${targetId}`);

    if (!audio) {
      audio = document.createElement("audio");
      audio.id = `audio-${targetId}`;
      audio.autoplay = true;
      audio.playsInline = true;

      document.body.appendChild(audio);
    }

    audio.srcObject = event.streams[0];
    audio.muted = !speakerOn;

    audio.play().catch(() => {});
  };

  peerConnections.set(targetId, peer);

  return peer;
}

async function startVoicePeer(targetId) {
  try {
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true
      });
    }

    const peer = createPeerConnection(targetId);

    const offer = await peer.createOffer();

    await peer.setLocalDescription(offer);

    socket.emit("voice-offer", {
      to: targetId,
      offer
    });
  } catch (error) {
    console.error("Voice offer error:", error);
  }
}

async function handleVoiceOffer(data) {
  try {
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true
      });
    }

    const peer = createPeerConnection(data.from);

    await peer.setRemoteDescription(data.offer);

    const answer = await peer.createAnswer();

    await peer.setLocalDescription(answer);

    socket.emit("voice-answer", {
      to: data.from,
      answer
    });
  } catch (error) {
    console.error("Voice answer error:", error);
  }
}

async function handleVoiceAnswer(data) {
  const peer = peerConnections.get(data.from);

  if (!peer) return;

  try {
    await peer.setRemoteDescription(data.answer);
  } catch (error) {
    console.error(error);
  }
}

async function handleVoiceIce(data) {
  const peer = peerConnections.get(data.from);

  if (!peer || !data.candidate) return;

  try {
    await peer.addIceCandidate(data.candidate);
  } catch (error) {
    console.error(error);
  }
}

function removeVoicePeer(socketId) {
  const peer = peerConnections.get(socketId);

  if (peer) {
    peer.close();
    peerConnections.delete(socketId);
  }

  const audio = document.getElementById(`audio-${socketId}`);

  if (audio) audio.remove();
}

function stopVoice() {
  peerConnections.forEach(peer => peer.close());
  peerConnections.clear();

  document.querySelectorAll("audio[id^='audio-']").forEach(audio => {
    audio.remove();
  });

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  micOn = false;
}

/* =========================================
   MORE MENU
========================================= */

function toggleMorePanel() {
  const panel = $("morePanel");
  if (!panel) return;

  panel.classList.toggle("hidden");
}

/* =========================================
   EXIT ROOM
========================================= */

async function exitRoom() {
  if (!confirm("Are you sure you want to leave this room?")) {
    return;
  }

  await emitReply("leave-room");

  stopVoice();

  location.href = "index.html";
}

/* =========================================
   SHARE ROOM
========================================= */

function shareRoom() {
  const url = `${location.origin}/room.html?roomId=${encodeURIComponent(roomId)}`;

  if (navigator.share) {
    navigator.share({
      title: "Huka Voice Chat",
      text: `Join my room ${roomId}`,
      url
    }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url)
      .then(() => toast("Room link copied"))
      .catch(() => toast(url));
  } else {
    toast(url);
  }
}

/* =========================================
   EVENT LISTENERS
========================================= */

document.addEventListener("click", event => {
  const target = event.target.closest("button, [data-profile-id], [data-seat], [data-gift-id], [data-gift-category], [data-buy-frame], [data-equip-frame], [data-claim-task]");

  if (!target) return;

  if (target.dataset.seat) {
    takeSeat(target.dataset.seat);
  }

  if (target.dataset.profileId) {
    openUserProfile(target.dataset.profileId);
  }

  if (target.dataset.giftId) {
    selectGift(target.dataset.giftId);
  }

  if (target.dataset.giftCategory) {
    giftFilter = target.dataset.giftCategory;
    renderGiftCategories();
    renderGiftList();
  }

  if (target.dataset.buyFrame) {
    buyFrame(target.dataset.buyFrame);
  }

  if (target.dataset.equipFrame) {
    equipFrame(target.dataset.equipFrame);
  }

  if (target.dataset.claimTask) {
    claimRoomTask(target.dataset.claimTask);
  }
});

if ($("chatForm")) {
  $("chatForm").addEventListener("submit", sendMessage);
}

if ($("emojiButton")) {
  $("emojiButton").addEventListener("click", toggleEmojiPanel);
}

if ($("giftButton")) {
  $("giftButton").addEventListener("click", () => openGiftModal());
}

if ($("sendGiftButton")) {
  $("sendGiftButton").addEventListener("click", sendGift);
}

if ($("micButton")) {
  $("micButton").addEventListener("click", toggleMic);
}

if ($("speakerButton")) {
  $("speakerButton").addEventListener("click", toggleSpeaker);
}

if ($("inboxButton")) {
  $("inboxButton").addEventListener("click", openInbox);
}

if ($("moreButton")) {
  $("moreButton").addEventListener("click", toggleMorePanel);
}

if ($("shareButton")) {
  $("shareButton").addEventListener("click", shareRoom);
}

if ($("exitButton")) {
  $("exitButton").addEventListener("click", exitRoom);
}

if ($("leaveSeatButton")) {
  $("leaveSeatButton").addEventListener("click", leaveSeat);
}

if ($("clearChatButton")) {
  $("clearChatButton").addEventListener("click", clearChat);
}

if ($("youtubeButton")) {
  $("youtubeButton").addEventListener("click", () => showModal("youtubeModal"));
}

if ($("shareYoutubeButton")) {
  $("shareYoutubeButton").addEventListener("click", shareYoutube);
}

if ($("settingsButton")) {
  $("settingsButton").addEventListener("click", () => showModal("settingsModal"));
}

if ($("saveSettingsButton")) {
  $("saveSettingsButton").addEventListener("click", saveRoomSettings);
}

if ($("addAdminButton")) {
  $("addAdminButton").addEventListener("click", addAdmin);
}

if ($("removeAdminButton")) {
  $("removeAdminButton").addEventListener("click", removeAdmin);
}

if ($("kickUserButton")) {
  $("kickUserButton").addEventListener("click", kickMember);
}

if ($("muteUserButton")) {
  $("muteUserButton").addEventListener("click", muteMember);
}

if ($("followUserButton")) {
  $("followUserButton").addEventListener("click", followUser);
}

if ($("chatUserButton")) {
  $("chatUserButton").addEventListener("click", chatWithProfile);
}

if ($("profileGiftButton")) {
  $("profileGiftButton").addEventListener("click", giftToProfile);
}

if ($("roomTasksButton")) {
  $("roomTasksButton").addEventListener("click", openRoomTasks);
}

if ($("bagButton")) {
  $("bagButton").addEventListener("click", openBag);
}

if ($("giftSearch")) {
  $("giftSearch").addEventListener("input", renderGiftList);
}

/* =========================================
   MODAL CLOSE BUTTONS
========================================= */

document.querySelectorAll("[data-close-modal]").forEach(button => {
  button.addEventListener("click", () => {
    hideModal(button.dataset.closeModal);
  });
});

document.querySelectorAll(".modal").forEach(modal => {
  modal.addEventListener("click", event => {
    if (event.target === modal) {
      modal.classList.add("hidden");
    }
  });
});

/* =========================================
   SOCKET EVENTS
========================================= */

socket.on("connect", async () => {
  console.log("Connected to Huka server");

  const registered = await registerUser();

  if (registered) {
    await joinRoom();
  }
});

socket.on("disconnect", () => {
  toast("Connection lost. Reconnecting...");
});

socket.on("online-count", count => {
  setText("onlineCount", count);
});

socket.on("room-list", rooms => {
  const container = $("roomList");
  if (!container) return;

  container.innerHTML = rooms.map(room => `
    <div class="room-list-item">
      <strong>${escapeHTML(room.name)}</strong>
      <small>${room.members} members</small>
    </div>
  `).join("");
});

socket.on("members-update", data => {
  members = Array.isArray(data)
    ? data
    : data.members || [];

  if (data.seats) {
    seats = data.seats;
  }

  renderMembers();
  renderSeats();
});

socket.on("seats-update", data => {
  seats = data || [];
  renderSeats();
});

socket.on("room-update", room => {
  currentRoom = room;

  setText("roomName", room.name);
  setText("roomId", room.id);
});

socket.on("room-settings-update", settings => {
  roomSettings = settings;

  setText("roomName", settings.name);

  if ($("settingRoomName")) {
    $("settingRoomName").value = settings.name || "";
  }

  if ($("settingDescription")) {
    $("settingDescription").value = settings.description || "";
  }

  if ($("settingLocked")) {
    $("settingLocked").checked = Boolean(settings.locked);
  }

  if ($("settingYoutube")) {
    $("settingYoutube").checked = Boolean(settings.allowYoutube);
  }
});

socket.on("room-message", message => {
  addMessage(message);
});

socket.on("system-message", data => {
  addMessage({
    username: "Huka",
    message: data.message,
    time: Date.now()
  });
});

socket.on("chat-cleared", () => {
  setHTML("chatMessages", "");
  toast("Chat cleared");
});

socket.on("emoji-event", event => {
  addMessage({
    username: event.username,
    message: event.emoji,
    time: event.time
  });
});

socket.on("gift-event", showGiftEvent);

socket.on("gift-ranking", renderGiftRanking);

socket.on("profile-update", updateProfileData);

socket.on("inbox-data", messages => {
  inboxMessages = messages || [];
  renderInbox();
});

socket.on("inbox-messages", messages => {
  inboxMessages = messages || [];
  renderInbox();
});

socket.on("new-dm", message => {
  inboxMessages.push(message);
  renderInbox();
  toast("New inbox message");
});

socket.on("dm-sent", message => {
  inboxMessages.push(message);
  renderInbox();
});

socket.on("admin-status", data => {
  isAdmin = Boolean(data.isAdmin);

  const adminButton = $("settingsButton");

  if (adminButton) {
    adminButton.style.display = isAdmin ? "" : "none";
  }
});

socket.on("mic-update", data => {
  const member = members.find(
    item => item.socketId === data.socketId
  );

  if (member) {
    member.micOn = data.micOn;
    renderMembers();
  }
});

socket.on("force-mute", data => {
  if (data.muted && localStream) {
    micOn = false;

    localStream.getAudioTracks().forEach(track => {
      track.enabled = false;
    });

    if ($("micButton")) {
      $("micButton").textContent = "🔇";
    }

    toast("Your microphone was muted by room admin");
  }
});

socket.on("kicked-from-room", data => {
  toast(data.message || "You were removed from the room");

  stopVoice();

  setTimeout(() => {
    location.href = "index.html";
  }, 1000);
});

socket.on("youtube-link", addYoutubeLink);

socket.on("youtube-shared", addYoutubeLink);

socket.on("voice-existing-peers", async peerIds => {
  for (const id of peerIds || []) {
    await startVoicePeer(id);
  }
});

socket.on("voice-peer-joined", async data => {
  if (data.socketId) {
    await startVoicePeer(data.socketId);
  }
});

socket.on("voice-peer-left", data => {
  removeVoicePeer(data.socketId);
});

socket.on("voice-offer", handleVoiceOffer);

socket.on("voice-answer", handleVoiceAnswer);

socket.on("voice-ice", handleVoiceIce);

/* =========================================
   START
========================================= */

if (!roomId) {
  toast("Room ID not found");
} else {
  localStorage.setItem("hukaRoomId", roomId);
}

console.log("Huka Voice Chat Room JS Loaded");
