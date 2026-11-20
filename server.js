"use strict";

/* =========================================
   HUKA VOICE CHAT - SERVER
   Express + Socket.IO
========================================= */

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  maxHttpBufferSize: 1e6
});

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DB_FILE = path.join(__dirname, "huka-data.json");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    app: "Huka Voice Chat",
    status: "running"
  });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

/* =========================================
   DATABASE
========================================= */

let db = {
  nextUserId: 100001,
  nextRoomId: 100001,
  profiles: {},
  inbox: {}
};

try {
  if (fs.existsSync(DB_FILE)) {
    const saved = JSON.parse(
      fs.readFileSync(DB_FILE, "utf8")
    );

    db = {
      ...db,
      ...saved,
      profiles: saved.profiles || {},
      inbox: saved.inbox || {}
    };
  }
} catch (error) {
  console.error("Database load error:", error.message);
}

function saveDB() {
  try {
    const temp = DB_FILE + ".tmp";

    fs.writeFileSync(
      temp,
      JSON.stringify(db, null, 2)
    );

    fs.renameSync(temp, DB_FILE);
  } catch (error) {
    console.error("Database save error:", error.message);
  }
}

/* =========================================
   CONSTANTS
========================================= */

const ALLOWED_SEATS = [9, 11, 15, 20];

const GIFTS = [
  { id: "rose", name: "Rose", icon: "🌹", price: 10 },
  { id: "heart", name: "Heart", icon: "❤️", price: 50 },
  { id: "love", name: "Love", icon: "💕", price: 100 },
  { id: "crown", name: "Crown", icon: "👑", price: 500 },
  { id: "diamond", name: "Diamond", icon: "💎", price: 1000 },
  { id: "rocket", name: "Rocket", icon: "🚀", price: 2000 },
  { id: "castle", name: "Castle", icon: "🏰", price: 5000 },
  { id: "car", name: "Luxury Car", icon: "🚗", price: 10000 },
  { id: "plane", name: "Airplane", icon: "✈️", price: 20000 },
  { id: "universe", name: "Universe", icon: "🌌", price: 50000 }
];

const ALLOWED_EMOJIS = [
  "😀", "😍", "🥰", "😂", "🤣", "😘",
  "❤️", "💕", "🔥", "👏", "🎉", "🌹",
  "👍", "🥳", "😎", "💖", "✨", "🤗"
];

const online = new Map();
const rooms = new Map();

/* =========================================
   HELPERS
========================================= */

function clean(value, max = 100) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function reply(callback, data) {
  if (typeof callback === "function") {
    callback(data);
  }
}

function getUser(socket) {
  return online.get(socket.id) || null;
}

function getProfile(socket) {
  const user = getUser(socket);
  return user ? db.profiles[user.id] : null;
}

function getRoom(socket) {
  return rooms.get(socket.data.roomId) || null;
}

function isOwner(room, user) {
  return Boolean(room && user && room.ownerId === user.id);
}

function isAdmin(room, user) {
  return Boolean(
    room &&
    user &&
    (room.ownerId === user.id || room.admins.has(user.id))
  );
}

function isMember(room, socket) {
  return Boolean(room && room.members.has(socket.id));
}

function findGift(giftId) {
  return GIFTS.find(gift =>
    gift.id === giftId ||
    gift.name.toLowerCase() === String(giftId).toLowerCase()
  );
}

function getMembers(room) {
  return [...room.members].map(socketId => {
    const user = online.get(socketId);
    if (!user) return null;

    const seatIndex = room.seats.findIndex(
      seat => seat && seat.socketId === socketId
    );

    return {
      id: user.id,
      userId: user.id,
      name: user.name,
      avatar: user.avatar || "",
      socketId,
      seat: seatIndex === -1 ? null : seatIndex + 1,
      micOn: room.micStates.get(socketId) !== false,
      isOwner: room.ownerId === user.id,
      isAdmin: room.admins.has(user.id)
    };
  }).filter(Boolean);
}

function getRanking(room) {
  return [...room.giftRanking.values()]
    .sort((a, b) => b.coins - a.coins)
    .slice(0, 20);
}

function getRoomList() {
  return [...rooms.values()].map(room => ({
    id: room.id,
    name: room.name,
    owner: room.ownerName,
    ownerId: room.ownerId,
    members: room.members.size,
    seats: room.seats.length,
    locked: room.settings.locked
  }));
}

function updateRooms() {
  io.emit("room-list", getRoomList());
}

function updateRoom(room) {
  if (!room) return;

  const members = getMembers(room);

  io.to(room.id).emit("members-update", {
    members,
    seats: room.seats,
    room
  });

  io.to(room.id).emit("room-update", {
    id: room.id,
    name: room.name,
    owner: room.ownerName,
    ownerName: room.ownerName,
    ownerId: room.ownerId,
    description: room.settings.description,
    seats: room.seats,
    settings: room.settings
  });

  io.to(room.id).emit("seats-update", room.seats);

  io.to(room.id).emit("room-settings-update", {
    name: room.name,
    description: room.settings.description,
    seats: room.seats.length,
    locked: room.settings.locked,
    allowYoutube: room.settings.allowYoutube
  });

  io.to(room.id).emit("gift-ranking", getRanking(room));

  for (const socketId of room.members) {
    const memberSocket = io.sockets.sockets.get(socketId);
    const member = online.get(socketId);

    if (memberSocket && member) {
      memberSocket.emit("admin-status", {
        isAdmin: isAdmin(room, member)
      });
    }
  }

  updateRooms();
}

function removeFromSeat(room, socketId) {
  room.seats = room.seats.map(seat =>
    seat && seat.socketId === socketId ? null : seat
  );
}

function leaveRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  const room = rooms.get(roomId);
  const user = getUser(socket);

  if (room) {
    room.members.delete(socket.id);
    room.micStates.delete(socket.id);

    removeFromSeat(room, socket.id);

    socket.to(roomId).emit("system-message", {
      message: `${user?.name || "User"} left the room.`
    });

    socket.to(roomId).emit("voice-peer-left", {
      socketId: socket.id
    });

    socket.leave(roomId);

    if (room.members.size === 0) {
      rooms.delete(roomId);
      updateRooms();
    } else {
      updateRoom(room);
    }
  }

  socket.data.roomId = null;
}

/* =========================================
   SOCKET CONNECTION
========================================= */

io.on("connection", socket => {
  socket.data.roomId = null;
  socket.data.userId = null;

  /* =======================================
     REGISTER
  ======================================= */

  socket.on("register", (data, callback) => {
    const name = clean(data?.name, 20) || "Huka User";

    const requestedId = clean(
      data?.userId || data?.profileId,
      20
    );

    let id = requestedId;
    let profile = db.profiles[id];

    if (!profile) {
      id = String(db.nextUserId++);

      profile = {
        id,
        name,
        avatar: "",
        bio: "",
        coins: 1000,
        diamonds: 0,
        level: 1,
        totalGifts: 0,
        createdAt: Date.now()
      };

      db.profiles[id] = profile;
    } else {
      profile.name = name;
    }

    socket.data.userId = id;

    const user = {
      id,
      name: profile.name,
      avatar: profile.avatar || "",
      coins: Number(profile.coins) || 0,
      diamonds: Number(profile.diamonds) || 0,
      level: Number(profile.level) || 1
    };

    online.set(socket.id, user);

    saveDB();

    reply(callback, {
      ok: true,
      user
    });

    io.emit("online-count", online.size);
  });

  /* =======================================
     PROFILE
  ======================================= */

  socket.on("get-profile", (data, callback) => {
    const user = getUser(socket);

    if (!user) {
      return reply(callback, {
        ok: false,
        message: "Register first"
      });
    }

    const profile = db.profiles[user.id];

    reply(callback, {
      ok: true,
      profile
    });
  });

  socket.on("profile-update", (data, callback) => {
    const user = getUser(socket);

    if (!user) {
      return reply(callback, { ok: false });
    }

    const profile = db.profiles[user.id];

    if (data.name !== undefined) {
      profile.name = clean(data.name, 20) || profile.name;
      user.name = profile.name;
    }

    if (data.avatar !== undefined) {
      profile.avatar = clean(data.avatar, 500000);
      user.avatar = profile.avatar;
    }

    if (data.bio !== undefined) {
      profile.bio = clean(data.bio, 250);
    }

    saveDB();

    reply(callback, {
      ok: true,
      profile
    });

    socket.emit("profile-update", profile);
  });

  /* =======================================
     ROOM LIST
  ======================================= */

  socket.on("get-rooms", () => {
    socket.emit("room-list", getRoomList());
  });

  socket.on("room-list", () => {
    socket.emit("room-list", getRoomList());
  });

  /* =======================================
     CREATE ROOM
  ======================================= */

  socket.on("create-room", (data, callback) => {
    const user = getUser(socket);

    if (!user) {
      return reply(callback, {
        ok: false,
        message: "Register first"
      });
    }

    if (socket.data.roomId) {
      leaveRoom(socket);
    }

    const id = String(db.nextRoomId++);

    const requestedSeats = Number(data?.seats);
    const seatCount = ALLOWED_SEATS.includes(requestedSeats)
      ? requestedSeats
      : 9;

    const room = {
      id,
      name: clean(data?.name, 35) || `${user.name}'s Room`,
      ownerId: user.id,
      ownerName: user.name,

      admins: new Set(),
      members: new Set(),

      seats: Array(seatCount).fill(null),
      micStates: new Map(),

      messages: [],
      giftRanking: new Map(),

      settings: {
        locked: false,
        allowYoutube: true,
        description: clean(data?.description, 150)
      },

      createdAt: Date.now()
    };

    rooms.set(id, room);

    reply(callback, {
      ok: true,
      id,
      seats: seatCount
    });

    updateRooms();
  });

  /* =======================================
     JOIN ROOM
  ======================================= */

  socket.on("join-room", (data, callback) => {
    const user = getUser(socket);
    const roomId = clean(data?.roomId, 20);
    const room = rooms.get(roomId);

    if (!user) {
      return reply(callback, {
        ok: false,
        message: "Register first"
      });
    }

    if (!room) {
      return reply(callback, {
        ok: false,
        message: "Room not found"
      });
    }

    if (room.settings.locked && !isAdmin(room, user)) {
      return reply(callback, {
        ok: false,
        message: "This room is locked"
      });
    }

    if (socket.data.roomId) {
      leaveRoom(socket);
    }

    socket.join(roomId);
    socket.data.roomId = roomId;

    room.members.add(socket.id);
    room.micStates.set(socket.id, true);

    reply(callback, {
      ok: true,
      room: {
        id: room.id,
        name: room.name,
        owner: room.ownerName,
        ownerName: room.ownerName,
        ownerId: room.ownerId
      },
      messages: room.messages,
      seats: room.seats,
      settings: room.settings,
      members: getMembers(room)
    });

    socket.to(roomId).emit("system-message", {
      message: `${user.name} joined the room.`
    });

    socket.emit("voice-existing-peers",
      [...room.members].filter(id => id !== socket.id)
    );

    socket.to(roomId).emit("voice-peer-joined", {
      socketId: socket.id
    });

    updateRoom(room);
  });

  socket.on("leave-room", (data, callback) => {
    leaveRoom(socket);
    reply(callback, { ok: true });
  });

  /* =======================================
     SEATS
  ======================================= */

  socket.on("take-seat", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);

    if (!room || !user || !isMember(room, socket)) {
      return reply(callback, {
        ok: false,
        message: "Join a room first"
      });
    }

    // room.js sends seat numbers from 1 to 20
    const seatNumber = typeof data === "object"
      ? Number(data.seat)
      : Number(data);

    const index = seatNumber - 1;

    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= room.seats.length
    ) {
      return reply(callback, {
        ok: false,
        message: "Invalid seat"
      });
    }

    if (room.seats[index]) {
      return reply(callback, {
        ok: false,
        message: "Seat is occupied"
      });
    }

    removeFromSeat(room, socket.id);

    room.seats[index] = {
      socketId: socket.id,
      userId: user.id,
      id: user.id,
      name: user.name
    };

    reply(callback, { ok: true });

    updateRoom(room);
  });

  socket.on("leave-seat", (data, callback) => {
    const room = getRoom(socket);

    if (!room) {
      return reply(callback, {
        ok: false,
        message: "Join a room first"
      });
    }

    removeFromSeat(room, socket.id);

    reply(callback, { ok: true });

    updateRoom(room);
  });

  /* =======================================
     CHAT
  ======================================= */

  socket.on("room-message", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);

    const messageText = clean(
      data?.message || data?.text,
      500
    );

    if (!room || !user || !isMember(room, socket) || !messageText) {
      return reply(callback, {
        ok: false,
        message: "Invalid message"
      });
    }

    const message = {
      username: user.name,
      name: user.name,
      userId: user.id,
      message: messageText,
      text: messageText,
      time: Date.now()
    };

    room.messages.push(message);

    if (room.messages.length > 100) {
      room.messages.shift();
    }

    io.to(room.id).emit("room-message", message);

    reply(callback, { ok: true });
  });

  /* =======================================
     CLEAR CHAT
  ======================================= */

  socket.on("clear-chat", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);

    if (!room || !isAdmin(room, user)) {
      return reply(callback, {
        ok: false,
        message: "Only Owner/Admin can clear chat"
      });
    }

    room.messages = [];

    io.to(room.id).emit("chat-cleared", {
      by: user.name,
      time: Date.now()
    });

    reply(callback, { ok: true });
  });

  /* =======================================
     EMOJI
  ======================================= */

  socket.on("send-emoji", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const emoji = clean(data?.emoji, 12);

    if (!room || !user || !isMember(room, socket)) {
      return reply(callback, { ok: false });
    }

    if (!ALLOWED_EMOJIS.includes(emoji)) {
      return reply(callback, {
        ok: false,
        message: "Invalid emoji"
      });
    }

    io.to(room.id).emit("emoji-event", {
      username: user.name,
      name: user.name,
      userId: user.id,
      emoji,
      time: Date.now()
    });

    reply(callback, { ok: true });
  });

  /* =======================================
     GIFTS
  ======================================= */

  socket.on("get-gifts", callback => {
    socket.emit("gift-list", GIFTS);

    reply(callback, {
      ok: true,
      gifts: GIFTS
    });
  });

  socket.on("send-gift", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const profile = getProfile(socket);

    if (!room || !user || !profile || !isMember(room, socket)) {
      return reply(callback, {
        ok: false,
        message: "Join a room first"
      });
    }

    const gift = findGift(data?.giftId || data?.gift);
    const receiverId = clean(
      data?.receiverId || data?.to,
      20
    );

    const quantity = Math.max(
      1,
      Math.min(10, Number(data?.quantity) || 1)
    );

    if (!gift) {
      return reply(callback, {
        ok: false,
        message: "Gift not found"
      });
    }

    const totalCost = gift.price * quantity;

    if (profile.coins < totalCost) {
      return reply(callback, {
        ok: false,
        message: "Not enough coins"
      });
    }

    let receiver = null;
    let receiverSocketId = null;

    if (receiverId && receiverId !== "Everyone") {
      for (const socketId of room.members) {
        const member = online.get(socketId);

        if (member?.id === receiverId) {
          receiver = db.profiles[receiverId];
          receiverSocketId = socketId;
          break;
        }
      }

      if (!receiver) {
        return reply(callback, {
          ok: false,
          message: "Receiver is not in this room"
        });
      }
    }

    profile.coins -= totalCost;

    if (receiver) {
      receiver.diamonds =
        (Number(receiver.diamonds) || 0) + totalCost;

      receiver.totalGifts =
        (Number(receiver.totalGifts) || 0) + quantity;
    }

    user.coins = profile.coins;

    const rankingId = receiverId || "Everyone";

    const ranking = room.giftRanking.get(rankingId) || {
      userId: rankingId,
      name: receiver?.name || "Everyone",
      gifts: 0,
      coins: 0
    };

    ranking.gifts += quantity;
    ranking.coins += totalCost;

    room.giftRanking.set(rankingId, ranking);

    const event = {
      senderName: user.name,
      username: user.name,
      senderId: user.id,
      receiverId: receiverId || null,
      receiverName: receiver?.name || "Everyone",
      giftName: gift.name,
      giftIcon: gift.icon,
      price: gift.price,
      quantity,
      time: Date.now()
    };

    saveDB();

    socket.emit("profile-update", {
      id: user.id,
      name: user.name,
      coins: profile.coins,
      diamonds: profile.diamonds
    });

    if (receiverSocketId) {
      const receiverSocket = io.sockets.sockets.get(receiverSocketId);

      if (receiverSocket) {
        receiverSocket.emit("profile-update", {
          id: receiver.id,
          name: receiver.name,
          coins: receiver.coins,
          diamonds: receiver.diamonds
        });
      }
    }

    io.to(room.id).emit("gift-event", event);
    io.to(room.id).emit("gift-ranking", getRanking(room));

    reply(callback, {
      ok: true,
      coins: profile.coins,
      diamonds: profile.diamonds
    });
  });

  /* =======================================
     MIC STATE
  ======================================= */

  socket.on("mic-state", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);

    if (!room || !user || !isMember(room, socket)) {
      return reply(callback, { ok: false });
    }

    const micOn = data?.micOn !== undefined
      ? Boolean(data.micOn)
      : !Boolean(data?.muted);

    room.micStates.set(socket.id, micOn);

    io.to(room.id).emit("mic-update", {
      socketId: socket.id,
      userId: user.id,
      micOn
    });

    reply(callback, { ok: true });
  });

  /* =======================================
     FORCE MUTE
  ======================================= */

  socket.on("force-mute", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const targetId = clean(data?.userId, 20);

    if (!room || !isAdmin(room, user)) {
      return reply(callback, {
        ok: false,
        message: "Permission denied"
      });
    }

    let found = false;

    for (const socketId of room.members) {
      const member = online.get(socketId);

      if (member?.id === targetId) {
        room.micStates.set(socketId, false);

        io.to(socketId).emit("force-mute", {
          muted: true
        });

        io.to(room.id).emit("mic-update", {
          socketId,
          userId: targetId,
          micOn: false
        });

        found = true;
        break;
      }
    }

    reply(callback, {
      ok: found,
      message: found ? "Muted" : "User not found"
    });
  });

  /* =======================================
     ADMIN MANAGEMENT
  ======================================= */

  socket.on("add-room-admin", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const targetId = clean(data?.userId, 20);

    if (!room || !isOwner(room, user)) {
      return reply(callback, {
        ok: false,
        message: "Only owner can add admins"
      });
    }

    if (!db.profiles[targetId] || targetId === room.ownerId) {
      return reply(callback, {
        ok: false,
        message: "User not found"
      });
    }

    room.admins.add(targetId);

    reply(callback, { ok: true });

    updateRoom(room);
  });

  socket.on("remove-room-admin", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const targetId = clean(data?.userId, 20);

    if (!room || !isOwner(room, user)) {
      return reply(callback, {
        ok: false,
        message: "Only owner can remove admins"
      });
    }

    room.admins.delete(targetId);

    reply(callback, { ok: true });

    updateRoom(room);
  });

  /* =======================================
     KICK MEMBER
  ======================================= */

  socket.on("kick-member", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const targetId = clean(data?.userId, 20);

    if (!room || !isAdmin(room, user)) {
      return reply(callback, {
        ok: false,
        message: "Permission denied"
      });
    }

    if (targetId === room.ownerId) {
      return reply(callback, {
        ok: false,
        message: "Owner cannot be kicked"
      });
    }

    let found = false;

    for (const socketId of room.members) {
      const member = online.get(socketId);

      if (member?.id === targetId) {
        const targetSocket = io.sockets.sockets.get(socketId);

        if (targetSocket) {
          targetSocket.emit("kicked-from-room", {
            message: "You were removed from this room"
          });

          leaveRoom(targetSocket);
        }

        found = true;
        break;
      }
    }

    reply(callback, {
      ok: found,
      message: found ? "Member removed" : "Member not found"
    });
  });

  /* =======================================
     ROOM SETTINGS
  ======================================= */

  socket.on("update-room-settings", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);

    if (!room || !isAdmin(room, user)) {
      return reply(callback, {
        ok: false,
        message: "Only Owner/Admin can update settings"
      });
    }

    if (data.name !== undefined) {
      room.name = clean(data.name, 35) || room.name;
    }

    if (data.description !== undefined) {
      room.settings.description = clean(data.description, 150);
    }

    if (data.locked !== undefined) {
      if (!isOwner(room, user)) {
        return reply(callback, {
          ok: false,
          message: "Only owner can lock the room"
        });
      }

      room.settings.locked = Boolean(data.locked);
    }

    if (data.youtubeAllowed !== undefined) {
      room.settings.allowYoutube = Boolean(data.youtubeAllowed);
    }

    if (data.allowYoutube !== undefined) {
      room.settings.allowYoutube = Boolean(data.allowYoutube);
    }

    if (data.seats !== undefined) {
      if (!isOwner(room, user)) {
        return reply(callback, {
          ok: false,
          message: "Only owner can change seat count"
        });
      }

      const count = Number(data.seats);

      if (!ALLOWED_SEATS.includes(count)) {
        return reply(callback, {
          ok: false,
          message: "Choose 9, 11, 15 or 20 seats"
        });
      }

      if (count < room.seats.length) {
        const removedSeats = room.seats.slice(count);

        if (removedSeats.some(Boolean)) {
          return reply(callback, {
            ok: false,
            message: "Some seats are occupied"
          });
        }
      }

      room.seats = Array(count)
        .fill(null)
        .map((_, index) => room.seats[index] || null);
    }

    reply(callback, {
      ok: true,
      message: "Settings updated"
    });

    updateRoom(room);
  });

  /* =======================================
     YOUTUBE SHARING
  ======================================= */

  socket.on("share-youtube", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);

    if (!room || !user || !isMember(room, socket)) {
      return reply(callback, {
        ok: false,
        message: "Join a room first"
      });
    }

    if (!room.settings.allowYoutube) {
      return reply(callback, {
        ok: false,
        message: "YouTube sharing is disabled"
      });
    }

    if (!isAdmin(room, user)) {
      return reply(callback, {
        ok: false,
        message: "Only Owner/Admin can share links"
      });
    }

    let url;

    try {
      url = new URL(clean(data?.url, 500));
    } catch {
      return reply(callback, {
        ok: false,
        message: "Invalid link"
      });
    }

    const validHosts = [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "youtu.be",
      "www.youtu.be"
    ];

    if (url.protocol !== "https:" || !validHosts.includes(url.hostname)) {
      return reply(callback, {
        ok: false,
        message: "Only YouTube links are allowed"
      });
    }

    const event = {
      url: url.toString(),
      by: user.name,
      username: user.name,
      time: Date.now()
    };

    io.to(room.id).emit("youtube-shared", event);
    io.to(room.id).emit("youtube-link", event);

    reply(callback, { ok: true });
  });

  /* =======================================
     INBOX
  ======================================= */

  socket.on("get-inbox", callback => {
    const user = getUser(socket);

    if (!user) {
      return reply(callback, {
        ok: false,
        message: "Register first"
      });
    }

    const messages = db.inbox[user.id] || [];

    socket.emit("inbox-messages", messages);
    socket.emit("inbox-data", messages);

    reply(callback, {
      ok: true,
      messages
    });
  });

  socket.on("send-dm", (data, callback) => {
    const user = getUser(socket);
    const targetId = clean(data?.to, 20);
    const messageText = clean(data?.text, 500);

    if (!user || !db.profiles[targetId] || !messageText) {
      return reply(callback, {
        ok: false,
        message: "Invalid message"
      });
    }

    const message = {
      from: user.name,
      fromId: user.id,
      to: db.profiles[targetId].name,
      toId: targetId,
      message: messageText,
      text: messageText,
      time: Date.now()
    };

    db.inbox[targetId] ||= [];
    db.inbox[user.id] ||= [];

    db.inbox[targetId].push(message);
    db.inbox[user.id].push(message);

    db.inbox[targetId] = db.inbox[targetId].slice(-500);
    db.inbox[user.id] = db.inbox[user.id].slice(-500);

    saveDB();

    for (const [socketId, onlineUser] of online.entries()) {
      if (onlineUser.id === targetId) {
        io.to(socketId).emit("new-dm", message);
      }
    }

    socket.emit("dm-sent", message);

    reply(callback, { ok: true });
  });

  /* =======================================
     WEBRTC SIGNALING
  ======================================= */

  socket.on("voice-offer", data => {
    const room = getRoom(socket);
    if (!room || !isMember(room, socket)) return;

    const targetId = clean(data?.to || data?.targetId, 100);
    const target = io.sockets.sockets.get(targetId);

    if (
      !target ||
      target.data.roomId !== room.id ||
      !data?.offer
    ) return;

    target.emit("voice-offer", {
      from: socket.id,
      offer: data.offer
    });
  });

  socket.on("voice-answer", data => {
    const room = getRoom(socket);
    if (!room || !isMember(room, socket)) return;

    const targetId = clean(data?.to || data?.targetId, 100);
    const target = io.sockets.sockets.get(targetId);

    if (
      !target ||
      target.data.roomId !== room.id ||
      !data?.answer
    ) return;

    target.emit("voice-answer", {
      from: socket.id,
      answer: data.answer
    });
  });

  socket.on("voice-ice", data => {
    const room = getRoom(socket);
    if (!room || !isMember(room, socket)) return;

    const targetId = clean(data?.to || data?.targetId, 100);
    const target = io.sockets.sockets.get(targetId);

    if (
      !target ||
      target.data.roomId !== room.id ||
      !data?.candidate
    ) return;

    target.emit("voice-ice", {
      from: socket.id,
      candidate: data.candidate
    });
  });

  /* =======================================
     DISCONNECT
  ======================================= */

  socket.on("disconnect", () => {
    leaveRoom(socket);
    online.delete(socket.id);

    io.emit("online-count", online.size);
  });

});

/* =========================================
   START SERVER
========================================= */

server.listen(PORT, "0.0.0.0", () => {
  console.log("=================================");
  console.log("HUKA VOICE CHAT SERVER STARTED");
  console.log("Port:", PORT);
  console.log("Public folder:", PUBLIC_DIR);
  console.log("=================================");
});
