```javascript
const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e6
});

const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, "public");
const INDEX_FILE = path.join(PUBLIC_DIR, "index.html");
const DB_FILE = path.join(__dirname, "huka-data.json");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  if (!fs.existsSync(INDEX_FILE)) {
    return res.status(404).send(
      "Huka error: public/index.html file not found."
    );
  }

  res.sendFile(INDEX_FILE);
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    app: "Huka Voice Chat",
    indexExists: fs.existsSync(INDEX_FILE)
  });
});

// =====================================
// DATABASE
// =====================================

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
  console.log("Database load error:", error.message);
}

function saveDB() {
  try {
    const tempFile = DB_FILE + ".tmp";

    fs.writeFileSync(
      tempFile,
      JSON.stringify(db, null, 2)
    );

    fs.renameSync(tempFile, DB_FILE);
  } catch (error) {
    console.log("Database save error:", error.message);
  }
}

// =====================================
// CONSTANTS
// =====================================

const ALLOWED_SEATS = [9, 11, 15, 20];

const gifts = {
  Rose: 10,
  Heart: 50,
  Crown: 100,
  Diamond: 500,
  Rocket: 1000,
  Castle: 5000,
  Galaxy: 10000
};

const emojis = [
  "❤️", "😂", "😍", "🔥", "🥰",
  "👏", "🎉", "😘", "🌹", "💎"
];

const online = new Map();
const rooms = new Map();

// =====================================
// HELPERS
// =====================================

function clean(value, max = 100) {
  return String(value || "")
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
  return !!room && !!user &&
    room.ownerId === user.id;
}

function isAdmin(room, user) {
  return !!room && !!user &&
    (room.ownerId === user.id ||
      room.admins.has(user.id));
}

function isMember(room, socket) {
  return !!room && room.members.has(socket.id);
}

function syncUser(socket) {
  const user = getUser(socket);
  const profile = getProfile(socket);

  if (!user || !profile) return;

  user.coins = profile.coins;
  user.diamonds = profile.diamonds;
  user.level = profile.level;

  socket.emit("profile-update", {
    id: user.id,
    name: user.name,
    coins: user.coins,
    diamonds: user.diamonds,
    level: user.level
  });
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

function getMembers(room) {
  return [...room.members]
    .map(socketId => {
      const user = online.get(socketId);

      if (!user) return null;

      const seatIndex = room.seats.findIndex(
        seat => seat?.socketId === socketId
      );

      return {
        id: user.id,
        name: user.name,
        coins: user.coins,
        diamonds: user.diamonds,
        level: user.level,
        socketId,
        seat: seatIndex === -1 ? null : seatIndex,
        micOn: room.micStates.get(socketId) !== false,
        isOwner: room.ownerId === user.id,
        isAdmin: room.admins.has(user.id)
      };
    })
    .filter(Boolean);
}

function getRanking(room) {
  return [...room.giftRanking.entries()]
    .map(([userId, data]) => ({
      userId,
      name: data.name,
      gifts: data.gifts,
      coins: data.coins
    }))
    .sort((a, b) => b.coins - a.coins)
    .slice(0, 20);
}

function updateRoom(roomId) {
  const room = rooms.get(roomId);

  if (!room) return;

  io.to(roomId).emit("seats-update", room.seats);

  io.to(roomId).emit("members-update", {
    members: getMembers(room)
  });

  io.to(roomId).emit("room-settings-update", {
    name: room.name,
    seats: room.seats.length,
    locked: room.settings.locked,
    allowYoutube: room.settings.allowYoutube,
    description: room.settings.description
  });

  io.to(roomId).emit(
    "gift-ranking",
    getRanking(room)
  );

  updateRooms();
}

function systemMessage(room, text) {
  io.to(room.id).emit("system-message", text);
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

  if (room) {
    const user = getUser(socket);

    room.members.delete(socket.id);
    room.micStates.delete(socket.id);

    removeFromSeat(room, socket.id);

    socket.to(roomId).emit(
      "system-message",
      `${user?.name || "User"} left the room.`
    );

    socket.to(roomId).emit(
      "voice-peer-left",
      { socketId: socket.id }
    );

    socket.leave(roomId);

    if (room.members.size === 0) {
      rooms.delete(roomId);
      updateRooms();
    } else {
      updateRoom(roomId);
    }
  }

  socket.data.roomId = null;
}

// =====================================
// REGISTER USER
// =====================================

io.on("connection", socket => {

  socket.data.roomId = null;

  socket.on("register", (data, callback) => {
    const name = clean(data?.name, 20) || "Huka User";

    let id = clean(data?.profileId, 20);
    let profile = db.profiles[id];

    if (!profile) {
      id = String(db.nextUserId++);

      profile = {
        id,
        name,
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

    profile.coins = Number(profile.coins) || 0;
    profile.diamonds = Number(profile.diamonds) || 0;
    profile.level = Number(profile.level) || 1;
    profile.totalGifts = Number(profile.totalGifts) || 0;

    socket.data.userId = id;
    socket.data.name = name;

    const user = {
      id,
      name,
      coins: profile.coins,
      diamonds: profile.diamonds,
      level: profile.level
    };

    online.set(socket.id, user);

    saveDB();

    reply(callback, {
      ok: true,
      user
    });

    io.emit("online-count", online.size);
  });

  // =====================================
  // PROFILE
  // =====================================

  socket.on("get-profile", (data, callback) => {
    const user = getUser(socket);

    if (!user) {
      return reply(callback, {
        ok: false,
        error: "Register first."
      });
    }

    const profile = db.profiles[
      clean(data?.userId, 20) || user.id
    ];

    if (!profile) {
      return reply(callback, {
        ok: false,
        error: "Profile not found."
      });
    }

    reply(callback, {
      ok: true,
      profile: {
        id: profile.id,
        name: profile.name,
        coins: profile.coins,
        diamonds: profile.diamonds,
        level: profile.level,
        totalGifts: profile.totalGifts
      }
    });
  });

  socket.on("get-rooms", () => {
    socket.emit("room-list", getRoomList());
  });

  // =====================================
  // CREATE ROOM
  // =====================================

  socket.on("create-room", (data, callback) => {
    const user = getUser(socket);

    if (!user) {
      return reply(callback, {
        ok: false,
        error: "Register first."
      });
    }

    if (socket.data.roomId) {
      leaveRoom(socket);
    }

    const id = String(db.nextRoomId++);

    const seatCount = ALLOWED_SEATS.includes(
      Number(data?.seats)
    )
      ? Number(data.seats)
      : 9;

    const roomName =
      clean(data?.name, 35) ||
      `${user.name}'s Room`;

    const room = {
      id,
      name: roomName,
      ownerName: user.name,
      ownerId: user.id,

      admins: new Set(),

      members: new Set(),

      seats: Array(seatCount).fill(null),

      lockedSeats: new Set(),

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

    saveDB();

    reply(callback, {
      ok: true,
      id,
      seats: seatCount
    });

    updateRooms();
  });

  // =====================================
  // JOIN ROOM
  // =====================================

  socket.on("join-room", (data, callback) => {
    const user = getUser(socket);
    const id = clean(data?.roomId, 20);
    const room = rooms.get(id);

    if (!user) {
      return reply(callback, {
        ok: false,
        error: "Register first."
      });
    }

    if (!room) {
      return reply(callback, {
        ok: false,
        error: "Room not found."
      });
    }

    if (room.settings.locked &&
        !isAdmin(room, user)) {
      return reply(callback, {
        ok: false,
        error: "This room is locked."
      });
    }

    if (socket.data.roomId) {
      leaveRoom(socket);
    }

    socket.join(id);

    socket.data.roomId = id;

    room.members.add(socket.id);
    room.micStates.set(socket.id, true);

    reply(callback, {
      ok: true,

      room: {
        id: room.id,
        name: room.name,
        owner: room.ownerName,
        ownerId: room.ownerId
      },

      messages: room.messages,
      seats: room.seats,

      settings: room.settings,

      members: getMembers(room)
    });

    socket.to(id).emit(
      "system-message",
      `${user.name} joined.`
    );

    socket.to(id).emit("voice-peer-joined", {
      socketId: socket.id
    });

    socket.emit(
      "voice-existing-peers",
      [...room.members].filter(
        peer => peer !== socket.id
      )
    );

    updateRoom(id);
  });

  socket.on("leave-room", () => {
    leaveRoom(socket);
  });

  // =====================================
  // SEAT MANAGEMENT
  // =====================================

  socket.on("take-seat", (seatIndex, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const index = Number(seatIndex);

    if (!room || !user || !isMember(room, socket)) {
      return reply(callback, {
        ok: false,
        error: "Join a room first."
      });
    }

    if (!Number.isInteger(index) ||
        index < 0 ||
        index >= room.seats.length) {
      return reply(callback, {
        ok: false,
        error: "Invalid seat."
      });
    }

    if (room.lockedSeats.has(index) &&
        !isAdmin(room, user)) {
      return reply(callback, {
        ok: false,
        error: "This seat is locked."
      });
    }

    const oldIndex = room.seats.findIndex(
      seat => seat?.socketId === socket.id
    );

    if (oldIndex !== -1) {
      room.seats[oldIndex] = null;
    }

    if (room.seats[index] !== null) {
      reply(callback, {
        ok: false,
        error: "Seat is occupied."
      });

      updateRoom(room.id);
      return;
    }

    room.seats[index] = {
      socketId: socket.id,
      id: user.id,
      name: user.name
    };

    reply(callback, { ok: true });

    updateRoom(room.id);
  });

  socket.on("leave-seat", callback => {
    const room = getRoom(socket);

    if (!room) {
      return reply(callback, {
        ok: false,
        error: "Join a room first."
      });
    }

    removeFromSeat(room, socket.id);

    reply(callback, { ok: true });

    updateRoom(room.id);
  });

  socket.on("lock-seat", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const index = Number(data?.index);

    if (!room || !isAdmin(room, user)) {
      return reply(callback, {
        ok: false,
        error: "Only Owner/Admin can lock seats."
      });
    }

    if (!Number.isInteger(index) ||
        index < 0 ||
        index >= room.seats.length) {
      return reply(callback, {
        ok: false,
        error: "Invalid seat."
      });
    }

    room.lockedSeats.add(index);

    reply(callback, { ok: true });

    io.to(room.id).emit(
      "locked-seats-update",
      [...room.lockedSeats]
    );
  });

  socket.on("unlock-seat", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const index = Number(data?.index);

    if (!room || !isAdmin(room, user)) {
      return reply(callback, {
        ok: false,
        error: "Only Owner/Admin can unlock seats."
      });
    }

    room.lockedSeats.delete(index);

    reply(callback, { ok: true });

    io.to(room.id).emit(
      "locked-seats-update",
      [...room.lockedSeats]
    );
  });

  // =====================================
  // ROOM ADMIN MANAGEMENT
  // =====================================

  socket.on("add-room-admin", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const targetId = clean(data?.userId, 20);

    if (!room || !isOwner(room, user)) {
      return reply(callback, {
        ok: false,
        error: "Only room owner can add admins."
      });
    }

    if (!db.profiles[targetId] ||
        targetId === room.ownerId) {
      return reply(callback, {
        ok: false,
        error: "Invalid user."
      });
    }

    room.admins.add(targetId);

    reply(callback, { ok: true });

    io.to(room.id).emit("room-admins-update", [
      ...room.admins
    ]);

    updateRoom(room.id);
  });

  socket.on("remove-room-admin", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const targetId = clean(data?.userId, 20);

    if (!room || !isOwner(room, user)) {
      return reply(callback, {
        ok: false,
        error: "Only room owner can remove admins."
      });
    }

    room.admins.delete(targetId);

    reply(callback, { ok: true });

    io.to(room.id).emit("room-admins-update", [
      ...room.admins
    ]);

    updateRoom(room.id);
  });

  // =====================================
  // KICK MEMBER
  // =====================================

  socket.on("kick-member", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const targetId = clean(data?.userId, 20);

    if (!room || !isAdmin(room, user)) {
      return reply(callback, {
        ok: false,
        error: "Permission denied."
      });
    }

    if (targetId === room.ownerId) {
      return reply(callback, {
        ok: false,
        error: "Owner cannot be kicked."
      });
    }

    if (room.admins.has(targetId) &&
        !isOwner(room, user)) {
      return reply(callback, {
        ok: false,
        error: "Only owner can kick another admin."
      });
    }

    let found = false;

    for (const socketId of room.members) {
      const member = online.get(socketId);

      if (member?.id === targetId) {
        const targetSocket = io.sockets.sockets.get(
          socketId
        );

        if (targetSocket) {
          targetSocket.emit("kicked-from-room", {
            message: "You were removed from this room."
          });

          leaveRoom(targetSocket);
        }

        found = true;
        break;
      }
    }

    reply(callback, {
      ok: found,
      error: found ? undefined : "User not found."
    });
  });

  // =====================================
  // MIC MANAGEMENT
  // =====================================

  socket.on("mic-state", (data, callback) => {
    const room = getRoom(socket);

    if (!room || !isMember(room, socket)) {
      return reply(callback, {
        ok: false,
        error: "Join a room first."
      });
    }

    const micOn = Boolean(data?.micOn);

    room.micStates.set(socket.id, micOn);

    reply(callback, { ok: true });

    io.to(room.id).emit("mic-update", {
      socketId: socket.id,
      userId: getUser(socket)?.id,
      micOn
    });

    updateRoom(room.id);
  });

  socket.on("force-mute", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const targetId = clean(data?.userId, 20);

    if (!room || !isAdmin(room, user)) {
      return reply(callback, {
        ok: false,
        error: "Permission denied."
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
      error: found ? undefined : "User not found."
    });

    updateRoom(room.id);
  });

  // =====================================
  // ROOM CHAT
  // =====================================

  socket.on("room-message", data => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const text = clean(data?.text, 500);

    if (!room || !user ||
        !isMember(room, socket) || !text) {
      return;
    }

    const message = {
      name: user.name,
      userId: user.id,
      text,
      time: Date.now()
    };

    room.messages.push(message);

    if (room.messages.length > 100) {
      room.messages.shift();
    }

    io.to(room.id).emit("room-message", message);
  });

  // =====================================
  // CLEAR CHAT
  // =====================================

  socket.on("clear-chat", callback => {
    const room = getRoom(socket);
    const user = getUser(socket);

    if (!room || !isAdmin(room, user)) {
      return reply(callback, {
        ok: false,
        error: "Only Owner/Admin can clear chat."
      });
    }

    room.messages = [];

    io.to(room.id).emit("chat-cleared", {
      by: user.name,
      time: Date.now()
    });

    reply(callback, { ok: true });
  });

  // =====================================
  // LIVE EMOJI
  // =====================================

  socket.on("send-emoji", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const emoji = clean(data?.emoji, 12);

    if (!room || !user ||
        !isMember(room, socket) ||
        !emojis.includes(emoji)) {
      return reply(callback, {
        ok: false,
        error: "Invalid emoji."
      });
    }

    io.to(room.id).emit("emoji-event", {
      userId: user.id,
      name: user.name,
      emoji,
      time: Date.now()
    });

    reply(callback, { ok: true });
  });

  // =====================================
  // GIFTS AND COINS
  // =====================================

  socket.on("get-gifts", callback => {
    reply(callback, {
      ok: true,
      gifts
    });
  });

  socket.on("send-gift", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const profile = getProfile(socket);

    const gift = clean(data?.gift, 30);
    const cost = gifts[gift];

    const targetId = clean(data?.to, 20);

    if (!room || !user || !profile ||
        !isMember(room, socket) || !cost) {
      return reply(callback, {
        ok: false,
        error: "Invalid gift."
      });
    }

    if (profile.coins < cost) {
      return reply(callback, {
        ok: false,
        error: "Not enough coins."
      });
    }

    let receiver = null;
    let receiverSocketId = null;

    if (targetId && targetId !== "Everyone") {
      if (!db.profiles[targetId]) {
        return reply(callback, {
          ok: false,
          error: "Receiver not found."
        });
      }

      for (const socketId of room.members) {
        const member = online.get(socketId);

        if (member?.id === targetId) {
          receiver = db.profiles[targetId];
          receiverSocketId = socketId;
          break;
        }
      }

      if (!receiver) {
        return reply(callback, {
          ok: false,
          error: "Receiver is not in this room."
        });
      }
    }

    // Deduct sender coins
    profile.coins -= cost;

    // Add receiver diamonds
    if (receiver) {
      receiver.diamonds =
        (Number(receiver.diamonds) || 0) + cost;

      receiver.totalGifts =
        (Number(receiver.totalGifts) || 0) + 1;
    }

    user.coins = profile.coins;

    // Gift ranking
    const rankingId = targetId || "Everyone";

    const rankingData =
      room.giftRanking.get(rankingId) || {
        name: receiver?.name || "Everyone",
        gifts: 0,
        coins: 0
      };

    rankingData.gifts += 1;
    rankingData.coins += cost;

    room.giftRanking.set(
      rankingId,
      rankingData
    );

    const giftEvent = {
      from: user.name,
      fromId: user.id,
      to: receiver?.name || "Everyone",
      toId: receiver?.id || null,
      gift,
      cost,
      time: Date.now()
    };

    saveDB();

    syncUser(socket);

    if (receiverSocketId) {
      const receiverSocket =
        io.sockets.sockets.get(receiverSocketId);

      if (receiverSocket) {
        syncUser(receiverSocket);
      }
    }

    io.to(room.id).emit("gift-event", giftEvent);

    io.to(room.id).emit(
      "gift-ranking",
      getRanking(room)
    );

    reply(callback, {
      ok: true,
      coins: profile.coins,
      diamonds: profile.diamonds
    });
  });

  // =====================================
  // YOUTUBE LINK SHARING
  // =====================================

  socket.on("share-youtube", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);

    if (!room || !user ||
        !isMember(room, socket)) {
      return reply(callback, {
        ok: false,
        error: "Join a room first."
      });
    }

    if (!room.settings.allowYoutube) {
      return reply(callback, {
        ok: false,
        error: "YouTube sharing is disabled."
      });
    }

    if (!isAdmin(room, user)) {
      return reply(callback, {
        ok: false,
        error: "Only Owner/Admin can share YouTube links."
      });
    }

    const rawLink = clean(data?.url, 500);

    let url;

    try {
      url = new URL(rawLink);
    } catch {
      return reply(callback, {
        ok: false,
        error: "Invalid YouTube link."
      });
    }

    const host = url.hostname.toLowerCase();

    const validHost = [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "youtu.be",
      "www.youtu.be"
    ].includes(host);

    if (
      url.protocol !== "https:" ||
      !validHost ||
      !(
        host.includes("youtu.be") ||
        url.pathname === "/watch" ||
        url.pathname.startsWith("/shorts/") ||
        url.pathname.startsWith("/live/") ||
        url.pathname.startsWith("/embed/")
      )
    ) {
      return reply(callback, {
        ok: false,
        error: "Only valid YouTube links are allowed."
      });
    }

    const event = {
      url: url.toString(),
      by: user.name,
      userId: user.id,
      time: Date.now()
    };

    io.to(room.id).emit("youtube-link", event);

    reply(callback, { ok: true });
  });

  // =====================================
  // ROOM SETTINGS
  // =====================================

  socket.on("update-room-settings", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);

    if (!room || !isAdmin(room, user)) {
      return reply(callback, {
        ok: false,
        error: "Only Owner/Admin can change settings."
      });
    }

    if (data?.name !== undefined) {
      const name = clean(data.name, 35);

      if (name) {
        room.name = name;

        if (isOwner(room, user)) {
          room.ownerName = user.name;
        }
      }
    }

    if (data?.description !== undefined) {
      room.settings.description =
        clean(data.description, 150);
    }

    if (data?.locked !== undefined) {
      if (!isOwner(room, user)) {
        return reply(callback, {
          ok: false,
          error: "Only owner can lock the room."
        });
      }

      room.settings.locked =
        Boolean(data.locked);
    }

    if (data?.allowYoutube !== undefined) {
      room.settings.allowYoutube =
        Boolean(data.allowYoutube);
    }

    if (data?.seats !== undefined) {
      if (!isOwner(room, user)) {
        return reply(callback, {
          ok: false,
          error: "Only owner can change seat count."
        });
      }

      const count = Number(data.seats);

      if (!ALLOWED_SEATS.includes(count)) {
        return reply(callback, {
          ok: false,
          error: "Seats must be 9, 11, 15 or 20."
        });
      }

      if (count < room.seats.length) {
        const removedSeats =
          room.seats.slice(count);

        if (removedSeats.some(Boolean)) {
          return reply(callback, {
            ok: false,
            error: "Some removed seats are occupied."
          });
        }
      }

      const oldSeats = room.seats;

      room.seats = Array(count)
        .fill(null)
        .map((_, index) => oldSeats[index] || null);

      room.lockedSeats = new Set(
        [...room.lockedSeats].filter(
          index => index < count
        )
      );
    }

    reply(callback, {
      ok: true,
      settings: room.settings,
      seats: room.seats.length
    });

    updateRoom(room.id);
  });

  // =====================================
  // PRIVATE MESSAGES
  // =====================================

  socket.on("send-dm", data => {
    const user = getUser(socket);

    const targetId = clean(data?.to, 20);
    const messageText = clean(data?.text, 500);

    if (!user || !targetId || !messageText ||
        !db.profiles[targetId]) {
      socket.emit(
        "dm-error",
        "User ID ya message sahi nahi hai."
      );
      return;
    }

    const target = db.profiles[targetId];

    const message = {
      from: user.name,
      fromId: user.id,
      to: target.name,
      toId: targetId,
      text: messageText,
      time: Date.now()
    };

    db.inbox[targetId] ||= [];
    db.inbox[user.id] ||= [];

    db.inbox[targetId].push(message);
    db.inbox[user.id].push(message);

    if (db.inbox[targetId].length > 500) {
      db.inbox[targetId].shift();
    }

    if (db.inbox[user.id].length > 500) {
      db.inbox[user.id].shift();
    }

    saveDB();

    for (const [socketId, onlineUser] of online.entries()) {
      if (onlineUser.id === targetId) {
        io.to(socketId).emit("new-dm", message);
      }
    }

    socket.emit("dm-sent", message);
  });

  socket.on("get-inbox", () => {
    const user = getUser(socket);

    if (!user) return;

    socket.emit(
      "inbox-data",
      db.inbox[user.id] || []
    );
  });

  // =====================================
  // VOICE CHAT SIGNALING
  // =====================================

  socket.on("voice-offer", data => {
    const room = getRoom(socket);

    if (!room || !isMember(room, socket)) return;

    const target = io.sockets.sockets.get(data?.to);

    if (!target ||
        target.data.roomId !== room.id ||
        !data?.offer) {
      return;
    }

    target.emit("voice-offer", {
      from: socket.id,
      offer: data.offer
    });
  });

  socket.on("voice-answer", data => {
    const room = getRoom(socket);

    if (!room || !isMember(room, socket)) return;

    const target = io.sockets.sockets.get(data?.to);

    if (!target ||
        target.data.roomId !== room.id ||
        !data?.answer) {
      return;
    }

    target.emit("voice-answer", {
      from: socket.id,
      answer: data.answer
    });
  });

  socket.on("voice-ice", data => {
    const room = getRoom(socket);

    if (!room || !isMember(room, socket)) return;

    const target = io.sockets.sockets.get(data?.to);

    if (!target ||
        target.data.roomId !== room.id ||
        !data?.candidate) {
      return;
    }

    target.emit("voice-ice", {
      from: socket.id,
      candidate: data.candidate
    });
  });

  // =====================================
  // DISCONNECT
  // =====================================

  socket.on("disconnect", () => {
    leaveRoom(socket);

    online.delete(socket.id);

    io.emit("online-count", online.size);
  });

});

// =====================================
// SERVER START
// =====================================

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    "Huka Voice Chat running on port " + PORT
  );

  console.log("Public folder: " + PUBLIC_DIR);

  console.log(
    "Index file exists: " +
    fs.existsSync(INDEX_FILE)
  );
});
```
