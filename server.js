const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_FILE = path.join(__dirname, "huka-data.json");

app.use(express.json({ limit: "2mb" }));
app.use(express.static(PUBLIC_DIR));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    app: "Huka Voice Chat",
    status: "online"
  });
});

const ALLOWED_SEATS = [9, 11, 15, 20];

const GIFT_PRICES = {
  Rose: 10,
  Heart: 50,
  Crown: 100,
  Diamond: 500,
  Rocket: 1000,
  Castle: 5000,
  Galaxy: 10000
};

const ALLOWED_EMOJIS = [
  "😀", "😂", "😍", "🥰", "😘",
  "😎", "😭", "🔥", "❤️", "💖",
  "🎉", "👏", "🌹", "💎", "👑"
];

let profiles = {};
let inbox = {};

const onlineUsers = new Map();
const rooms = new Map();

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(
        fs.readFileSync(DATA_FILE, "utf8")
      );

      profiles = data.profiles || {};
      inbox = data.inbox || {};
    }
  } catch (error) {
    console.error("Data load error:", error);
  }
}

function saveData() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ profiles, inbox }, null, 2)
    );
  } catch (error) {
    console.error("Data save error:", error);
  }
}

function makeId() {
  return String(
    Math.floor(100000 + Math.random() * 900000)
  );
}

function cleanText(value, max = 200) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

function getProfile(userId) {
  return profiles[userId] || null;
}

function getRoom(roomId) {
  return rooms.get(String(roomId)) || null;
}

function getMembers(room) {
  return Object.values(room.members).map(member => ({
    id: member.id,
    name: member.name,
    avatar: member.avatar || "",
    isOwner: member.id === room.ownerId,
    isAdmin: room.admins.includes(member.id),
    micOn: member.micOn,
    seat: member.seat
  }));
}

function isOwner(room, userId) {
  return room.ownerId === userId;
}

function isAdmin(room, userId) {
  return room.admins.includes(userId);
}

function canManage(room, userId) {
  return isOwner(room, userId) || isAdmin(room, userId);
}

function emitMembers(roomId) {
  const room = getRoom(roomId);
  if (!room) return;

  io.to(roomId).emit("members", getMembers(room));
  io.to(roomId).emit("room-update", {
    id: room.id,
    name: room.name,
    description: room.description,
    seats: room.seats,
    locked: room.locked,
    ownerId: room.ownerId,
    memberCount: Object.keys(room.members).length
  });
}

function createRoomObject(id, ownerId, name, seats = 9) {
  return {
    id,
    name: cleanText(name || "Huka Room", 40),
    description: "",
    ownerId,
    seats: ALLOWED_SEATS.includes(Number(seats))
      ? Number(seats)
      : 9,
    locked: false,
    password: "",
    youtubeAllowed: true,
    youtubeLinks: [],
    admins: [],
    members: {},
    seatUsers: {},
    messages: [],
    giftRanking: {},
    createdAt: Date.now()
  };
}

function createProfile(userId, name) {
  return {
    id: userId,
    name: cleanText(name || "User", 20),
    avatar: "",
    coins: 1000,
    diamonds: 0,
    createdAt: Date.now()
  };
}

loadData();

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/room", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "room.html"));
});

app.get("/api/profile/:id", (req, res) => {
  const profile = getProfile(req.params.id);

  if (!profile) {
    return res.status(404).json({
      ok: false,
      message: "Profile not found"
    });
  }

  res.json({ ok: true, profile });
});

io.on("connection", socket => {
  console.log("User connected:", socket.id);

  socket.on("register", (data, callback) => {
    try {
      const name = cleanText(data?.name, 20);
      let userId = cleanText(data?.userId, 20);

      if (!name) {
        return callback?.({
          ok: false,
          message: "Name required"
        });
      }

      if (!userId || !profiles[userId]) {
        userId = makeId();

        while (profiles[userId]) {
          userId = makeId();
        }

        profiles[userId] = createProfile(userId, name);
      } else {
        profiles[userId].name = name;
      }

      socket.data.userId = userId;
      socket.data.username = name;

      onlineUsers.set(userId, socket.id);

      saveData();

      callback?.({
        ok: true,
        user: profiles[userId]
      });
    } catch (error) {
      console.error("Register error:", error);

      callback?.({
        ok: false,
        message: "Registration failed"
      });
    }
  });

  socket.on("create-room", (data, callback) => {
    try {
      const userId = socket.data.userId;

      if (!userId) {
        return callback?.({
          ok: false,
          message: "Register first"
        });
      }

      const roomId = makeId();

      const room = createRoomObject(
        roomId,
        userId,
        data?.name,
        data?.seats
      );

      rooms.set(roomId, room);

      callback?.({
        ok: true,
        id: roomId,
        seats: room.seats
      });
    } catch (error) {
      console.error("Create room error:", error);

      callback?.({
        ok: false,
        message: "Room creation failed"
      });
    }
  });

  socket.on("join-room", (data, callback) => {
    try {
      const userId = socket.data.userId;
      const username = socket.data.username;
      const roomId = cleanText(data?.roomId || data?.room, 40);

      if (!userId || !username) {
        return callback?.({
          ok: false,
          message: "Register first"
        });
      }

      const room = getRoom(roomId);

      if (!room) {
        return callback?.({
          ok: false,
          message: "Room not found"
        });
      }

      if (room.locked && room.password) {
        if (data?.password !== room.password) {
          return callback?.({
            ok: false,
            message: "Wrong room password"
          });
        }
      }

      socket.join(roomId);

      room.members[userId] = {
        id: userId,
        name: username,
        avatar: profiles[userId]?.avatar || "",
        micOn: false,
        seat: null
      };

      socket.data.roomId = roomId;

      emitMembers(roomId);

      callback?.({
        ok: true,
        room: {
          id: room.id,
          name: room.name,
          description: room.description,
          seats: room.seats,
          locked: room.locked,
          ownerId: room.ownerId,
          youtubeAllowed: room.youtubeAllowed,
          youtubeLinks: room.youtubeLinks
        },
        members: getMembers(room),
        messages: room.messages,
        giftRanking: room.giftRanking
      });

      io.to(roomId).emit("chatMessage", {
        username: "Huka Bot",
        message: username + " joined the room.",
        time: Date.now()
      });
    } catch (error) {
      console.error("Join room error:", error);

      callback?.({
        ok: false,
        message: "Unable to join room"
      });
    }
  });

  // LEAVE ROOM
  socket.on("leave-room", (callback) => {
    try {
      const userId = socket.data.userId;
      const roomId = socket.data.roomId;

      if (!roomId) {
        return callback?.({ ok: true });
      }

      const room = getRoom(roomId);

      if (room && room.members[userId]) {
        const member = room.members[userId];

        if (member.seat !== null) {
          delete room.seatUsers[member.seat];
        }

        delete room.members[userId];

        io.to(roomId).emit("chatMessage", {
          username: "Huka Bot",
          message: `${member.name} left the room.`,
          time: Date.now()
        });

        emitMembers(roomId);

        if (Object.keys(room.members).length === 0) {
          rooms.delete(roomId);
        }
      }

      socket.leave(roomId);
      socket.data.roomId = null;

      callback?.({ ok: true });
    } catch (error) {
      console.error("Leave room error:", error);
      callback?.({ ok: false, message: "Unable to leave room" });
    }
  });

  // ROOM CHAT
  socket.on("send-message", (data, callback) => {
    try {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      const room = getRoom(roomId);

      if (!room || !room.members[userId]) {
        return callback?.({ ok: false, message: "Join a room first" });
      }

      const message = cleanText(data?.message, 500);

      if (!message) {
        return callback?.({ ok: false, message: "Message is empty" });
      }

      const chatMessage = {
        id: makeId(),
        userId,
        username: socket.data.username,
        message,
        time: Date.now(),
        type: "text"
      };

      room.messages.push(chatMessage);
      room.messages = room.messages.slice(-100);

      io.to(roomId).emit("chatMessage", chatMessage);

      callback?.({ ok: true });
    } catch (error) {
      console.error("Message error:", error);
      callback?.({ ok: false, message: "Message failed" });
    }
  });

  // CLEAR ROOM CHAT
  socket.on("clear-chat", (callback) => {
    try {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      const room = getRoom(roomId);

      if (!room || !canManage(room, userId)) {
        return callback?.({ ok: false, message: "Permission denied" });
      }

      room.messages = [];

      io.to(roomId).emit("chat-cleared");

      callback?.({ ok: true });
    } catch (error) {
      console.error("Clear chat error:", error);
      callback?.({ ok: false, message: "Unable to clear chat" });
    }
  });

  // JOIN SEAT
  socket.on("join-seat", (data, callback) => {
    try {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      const room = getRoom(roomId);

      if (!room || !room.members[userId]) {
        return callback?.({ ok: false, message: "Join room first" });
      }

      const seat = Number(data?.seat);

      if (!Number.isInteger(seat) || seat < 1 || seat > room.seats) {
        return callback?.({ ok: false, message: "Invalid seat" });
      }

      if (room.seatUsers[seat]) {
        return callback?.({ ok: false, message: "Seat occupied" });
      }

      const member = room.members[userId];

      if (member.seat !== null) {
        delete room.seatUsers[member.seat];
      }

      room.seatUsers[seat] = userId;
      member.seat = seat;

      emitMembers(roomId);
      io.to(roomId).emit("seats-updated", room.seatUsers);

      callback?.({ ok: true, seat });
    } catch (error) {
      console.error("Join seat error:", error);
      callback?.({ ok: false, message: "Unable to join seat" });
    }
  });

  // LEAVE SEAT
  socket.on("leave-seat", (callback) => {
    try {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      const room = getRoom(roomId);

      if (!room || !room.members[userId]) {
        return callback?.({ ok: false, message: "Member not found" });
      }

      const member = room.members[userId];

      if (member.seat !== null) {
        delete room.seatUsers[member.seat];
        member.seat = null;
      }

      emitMembers(roomId);
      io.to(roomId).emit("seats-updated", room.seatUsers);

      callback?.({ ok: true });
    } catch (error) {
      console.error("Leave seat error:", error);
      callback?.({ ok: false, message: "Unable to leave seat" });
    }
  });

  // MIC ON/OFF
  socket.on("toggle-mic", (data, callback) => {
    try {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      const room = getRoom(roomId);

      if (!room || !room.members[userId]) {
        return callback?.({ ok: false, message: "Member not found" });
      }

      const member = room.members[userId];

      if (member.forceMuted && data?.micOn) {
        return callback?.({ ok: false, message: "You are muted by admin" });
      }

      member.micOn = Boolean(data?.micOn);

      emitMembers(roomId);

      callback?.({ ok: true, micOn: member.micOn });
    } catch (error) {
      console.error("Mic error:", error);
      callback?.({ ok: false, message: "Mic update failed" });
    }
  });

  // SEND EMOJI
  socket.on("send-emoji", (data, callback) => {
    try {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      const room = getRoom(roomId);

      if (!room || !room.members[userId]) {
        return callback?.({ ok: false, message: "Join room first" });
      }

      const emoji = cleanText(data?.emoji, 10);

      if (!ALLOWED_EMOJIS.includes(emoji)) {
        return callback?.({ ok: false, message: "Invalid emoji" });
      }

      io.to(roomId).emit("emoji-received", {
        userId,
        username: socket.data.username,
        emoji,
        time: Date.now()
      });

      callback?.({ ok: true });
    } catch (error) {
      console.error("Emoji error:", error);
      callback?.({ ok: false, message: "Emoji failed" });
    }
  });

  // SEND GIFT
  socket.on("send-gift", (data, callback) => {
    try {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      const room = getRoom(roomId);

      if (!room || !room.members[userId]) {
        return callback?.({ ok: false, message: "Join room first" });
      }

      const gift = cleanText(data?.gift, 30);
      const receiverId = cleanText(data?.receiverId, 30);
      const price = GIFT_PRICES[gift];

      if (!price) {
        return callback?.({ ok: false, message: "Invalid gift" });
      }

      const sender = getProfile(userId);

      if (!sender || sender.coins < price) {
        return callback?.({ ok: false, message: "Not enough coins" });
      }

      if (receiverId !== "Everyone" && !room.members[receiverId]) {
        return callback?.({ ok: false, message: "Receiver not in room" });
      }

      sender.coins -= price;

      if (receiverId !== "Everyone") {
        const receiver = getProfile(receiverId);

        if (receiver) {
          receiver.diamonds = (receiver.diamonds || 0) + price;
        }

        room.giftRanking[receiverId] =
          (room.giftRanking[receiverId] || 0) + price;
      }

      const giftData = {
        senderId: userId,
        senderName: socket.data.username,
        receiverId,
        gift,
        price,
        time: Date.now()
      };

      io.to(roomId).emit("gift-received", giftData);

      saveData();

      callback?.({
        ok: true,
        coins: sender.coins
      });
    } catch (error) {
      console.error("Gift error:", error);
      callback?.({ ok: false, message: "Gift failed" });
    }
  });

  // ROOM SETTINGS
  socket.on("update-room-settings", (data, callback) => {
    try {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      const room = getRoom(roomId);

      if (!room || !isOwner(room, userId)) {
        return callback?.({ ok: false, message: "Owner permission required" });
      }

      if (data?.name !== undefined) {
        room.name = cleanText(data.name, 40);
      }

      if (data?.description !== undefined) {
        room.description = cleanText(data.description, 200);
      }

      if (data?.seats !== undefined) {
        const seats = Number(data.seats);

        if (!ALLOWED_SEATS.includes(seats)) {
          return callback?.({ ok: false, message: "Invalid seat count" });
        }

        if (Object.keys(room.seatUsers).length > seats) {
          return callback?.({ ok: false, message: "Some seats are occupied" });
        }

        room.seats = seats;
      }

      if (data?.locked !== undefined) {
        room.locked = Boolean(data.locked);
      }

      if (data?.password !== undefined) {
        room.password = cleanText(data.password, 30);
      }

      if (data?.youtubeAllowed !== undefined) {
        room.youtubeAllowed = Boolean(data.youtubeAllowed);
      }

      emitMembers(roomId);

      callback?.({ ok: true });
    } catch (error) {
      console.error("Settings error:", error);
      callback?.({ ok: false, message: "Settings update failed" });
    }
  });

    // ADD ROOM ADMIN
  socket.on("add-admin", (data, callback) => {
    try {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      const targetId = cleanText(data?.userId, 30);
      const room = getRoom(roomId);

      if (!room || !isOwner(room, userId)) {
        return callback?.({
          ok: false,
          message: "Only owner can add admin"
        });
      }

      if (!room.members[targetId]) {
        return callback?.({
          ok: false,
          message: "User not in room"
        });
      }

      if (!room.admins.includes(targetId)) {
        room.admins.push(targetId);
      }

      emitMembers(roomId);
      callback?.({ ok: true });
    } catch (error) {
      console.error("Add admin error:", error);
      callback?.({ ok: false, message: "Unable to add admin" });
    }
  });

  // REMOVE ADMIN
  socket.on("remove-admin", (data, callback) => {
    try {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      const targetId = cleanText(data?.userId, 30);
      const room = getRoom(roomId);

      if (!room || !isOwner(room, userId)) {
        return callback?.({
          ok: false,
          message: "Only owner can remove admin"
        });
      }

      room.admins = room.admins.filter(id => id !== targetId);

      emitMembers(roomId);
      callback?.({ ok: true });
    } catch (error) {
      console.error("Remove admin error:", error);
      callback?.({ ok: false, message: "Unable to remove admin" });
    }
  });

  // KICK MEMBER
  socket.on("kick-member", (data, callback) => {
    try {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      const targetId = cleanText(data?.userId, 30);
      const room = getRoom(roomId);

      if (!room || !canManage(room, userId)) {
        return callback?.({
          ok: false,
          message: "Permission denied"
        });
      }

      if (targetId === room.ownerId) {
        return callback?.({
          ok: false,
          message: "Cannot kick room owner"
        });
      }

      if (isAdmin(room, targetId) && !isOwner(room, userId)) {
        return callback?.({
          ok: false,
          message: "Admin cannot kick another admin"
        });
      }

      const member = room.members[targetId];

      if (!member) {
        return callback?.({
          ok: false,
          message: "Member not found"
        });
      }

      if (member.seat !== null) {
        delete room.seatUsers[member.seat];
      }

      delete room.members[targetId];

      const targetSocketId = onlineUsers.get(targetId);
      const targetSocket = targetSocketId
        ? io.sockets.sockets.get(targetSocketId)
        : null;

      if (targetSocket) {
        targetSocket.leave(roomId);
        targetSocket.data.roomId = null;
        targetSocket.emit("kicked-from-room", {
          roomId,
          message: "You were removed from the room."
        });
      }

      emitMembers(roomId);

      callback?.({ ok: true });
    } catch (error) {
      console.error("Kick error:", error);
      callback?.({ ok: false, message: "Unable to kick member" });
    }
  });

  // FORCE MUTE MEMBER
  socket.on("force-mute", (data, callback) => {
    try {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      const targetId = cleanText(data?.userId, 30);
      const room = getRoom(roomId);

      if (!room || !canManage(room, userId)) {
        return callback?.({
          ok: false,
          message: "Permission denied"
        });
      }

      const member = room.members[targetId];

      if (!member) {
        return callback?.({
          ok: false,
          message: "Member not found"
        });
      }

      member.forceMuted = true;
      member.micOn = false;

      emitMembers(roomId);

      callback?.({ ok: true });
    } catch (error) {
      console.error("Force mute error:", error);
      callback?.({ ok: false, message: "Unable to mute member" });
    }
  });

  // UNMUTE MEMBER
  socket.on("unmute-member", (data, callback) => {
    try {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      const targetId = cleanText(data?.userId, 30);
      const room = getRoom(roomId);

      if (!room || !canManage(room, userId)) {
        return callback?.({
          ok: false,
          message: "Permission denied"
        });
      }

      const member = room.members[targetId];

      if (!member) {
        return callback?.({
          ok: false,
          message: "Member not found"
        });
      }

      member.forceMuted = false;

      emitMembers(roomId);
      callback?.({ ok: true });
    } catch (error) {
      console.error("Unmute error:", error);
      callback?.({ ok: false, message: "Unable to unmute member" });
    }
  });

  // YOUTUBE LINK
  socket.on("add-youtube-link", (data, callback) => {
    try {
      const roomId = socket.data.roomId;
      const userId = socket.data.userId;
      const room = getRoom(roomId);

      if (!room || !room.members[userId]) {
        return callback?.({
          ok: false,
          message: "Join room first"
        });
      }

      if (!room.youtubeAllowed) {
        return callback?.({
          ok: false,
          message: "YouTube sharing is disabled"
        });
      }

      const url = cleanText(data?.url, 500);

      let parsed;

      try {
        parsed = new URL(url);
      } catch {
        return callback?.({
          ok: false,
          message: "Invalid URL"
        });
      }

      const allowedHosts = [
        "youtube.com",
        "www.youtube.com",
        "youtu.be",
        "m.youtube.com"
      ];

      if (!allowedHosts.includes(parsed.hostname)) {
        return callback?.({
          ok: false,
          message: "Only YouTube links are allowed"
        });
      }

      const link = {
        url,
        addedBy: socket.data.username,
        time: Date.now()
      };

      room.youtubeLinks.push(link);
      room.youtubeLinks = room.youtubeLinks.slice(-20);

      io.to(roomId).emit("youtube-link-added", link);

      callback?.({ ok: true });
    } catch (error) {
      console.error("YouTube error:", error);
      callback?.({ ok: false, message: "Unable to add link" });
    }
  });

  // PRIVATE INBOX MESSAGE
  socket.on("send-inbox-message", (data, callback) => {
    try {
      const senderId = socket.data.userId;
      const receiverId = cleanText(data?.receiverId, 30);
      const message = cleanText(data?.message, 500);

      if (!senderId || !profiles[senderId]) {
        return callback?.({ ok: false, message: "Register first" });
      }

      if (!profiles[receiverId]) {
        return callback?.({ ok: false, message: "User not found" });
      }

      if (!message) {
        return callback?.({ ok: false, message: "Message is empty" });
      }

      if (!inbox[receiverId]) {
        inbox[receiverId] = [];
      }

      const inboxMessage = {
        id: makeId(),
        senderId,
        senderName: socket.data.username,
        receiverId,
        message,
        time: Date.now()
      };

      inbox[receiverId].push(inboxMessage);
      inbox[receiverId] = inbox[receiverId].slice(-200);

      saveData();

      const receiverSocketId = onlineUsers.get(receiverId);

      if (receiverSocketId) {
        io.to(receiverSocketId).emit("inbox-message", inboxMessage);
      }

      callback?.({ ok: true });
    } catch (error) {
      console.error("Inbox error:", error);
      callback?.({ ok: false, message: "Message failed" });
    }
  });

  // GET INBOX
  socket.on("get-inbox", (callback) => {
    try {
      const userId = socket.data.userId;

      if (!userId) {
        return callback?.({ ok: false, message: "Register first" });
      }

      callback?.({
        ok: true,
        messages: inbox[userId] || []
      });
    } catch (error) {
      console.error("Get inbox error:", error);
      callback?.({ ok: false, message: "Unable to load inbox" });
    }
  });

  // WEBRTC VOICE SIGNALING
  socket.on("voice-offer", data => {
    const targetId = cleanText(data?.targetId, 100);
    const target = io.sockets.sockets.get(targetId);

    if (target) {
      target.emit("voice-offer", {
        offer: data.offer,
        senderId: socket.id
      });
    }
  });

  socket.on("voice-answer", data => {
    const targetId = cleanText(data?.targetId, 100);
    const target = io.sockets.sockets.get(targetId);

    if (target) {
      target.emit("voice-answer", {
        answer: data.answer,
        senderId: socket.id
      });
    }
  });

  socket.on("voice-ice", data => {
    const targetId = cleanText(data?.targetId, 100);
    const target = io.sockets.sockets.get(targetId);

    if (target) {
      target.emit("voice-ice", {
        candidate: data.candidate,
        senderId: socket.id
      });
    }
  });

  // DISCONNECT
  socket.on("disconnect", () => {
    try {
      const userId = socket.data.userId;
      const roomId = socket.data.roomId;

      if (roomId) {
        const room = getRoom(roomId);

        if (room && room.members[userId]) {
          const member = room.members[userId];

          if (member.seat !== null) {
            delete room.seatUsers[member.seat];
          }

          delete room.members[userId];

          io.to(roomId).emit("chatMessage", {
            username: "Huka Bot",
            message: `${member.name} left the room.`,
            time: Date.now()
          });

          emitMembers(roomId);

          if (Object.keys(room.members).length === 0) {
            rooms.delete(roomId);
          }
        }
      }

      if (userId && onlineUsers.get(userId) === socket.id) {
        onlineUsers.delete(userId);
      }

      console.log("User disconnected:", socket.id);
    } catch (error) {
      console.error("Disconnect error:", error);
    }
  });
});

// SERVER START
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Huka Voice Chat running on port ${PORT}`);
});
