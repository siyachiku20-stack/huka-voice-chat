javascript
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
const INDEX_FILE = path.join(PUBLIC_DIR, "index.html");
const DB_FILE = path.join(__dirname, "huka-data.json");

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Main page: explicitly send index.html
app.get("/", (req, res) => {
  if (!fs.existsSync(INDEX_FILE)) {
    return res.status(404).send(
      "index.html not found. Check that it is inside the public folder."
    );
  }
  res.sendFile(INDEX_FILE);
});

app.get("/health", (req, res) => {
  res.json({ ok: true, app: "Huka Voice Chat" });
});

let db = {
  nextUserId: 100001,
  nextRoomId: 100001,
  profiles: {},
  inbox: {}
};

try {
  if (fs.existsSync(DB_FILE)) {
    db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
  }
} catch (error) {
  console.log("Database load error:", error.message);
}

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (error) {
    console.log("Database save error:", error.message);
  }
}

const online = new Map();
const rooms = new Map();

const gifts = {
  Rose: 10,
  Heart: 50,
  Crown: 100,
  Diamond: 500,
  Rocket: 1000
};

function clean(value, max = 100) {
  return String(value || "").trim().slice(0, max);
}

function getUser(socket) {
  return online.get(socket.id);
}

function getProfile(socket) {
  const user = getUser(socket);
  return user ? db.profiles[user.id] : null;
}

function getRoomList() {
  return [...rooms.values()].map(room => ({
    id: room.id,
    name: room.name,
    owner: room.ownerName,
    members: room.members.size,
    seats: room.seats
  }));
}

function updateRooms() {
  io.emit("room-list", getRoomList());
}

function updateRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  io.to(roomId).emit("seats-update", room.seats);

  io.to(roomId).emit("members-update", {
    members: [...room.members]
      .map(id => online.get(id))
      .filter(Boolean)
      .map(user => ({
        id: user.id,
        name: user.name,
        coins: user.coins
      }))
  });

  updateRooms();
}

function leaveRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  const room = rooms.get(roomId);

  if (room) {
    room.members.delete(socket.id);

    room.seats = room.seats.map(seat =>
      seat && seat.socketId === socket.id ? null : seat
    );

    socket.to(roomId).emit(
      "system-message",
      `${socket.data.name || "User"} left the room.`
    );

    updateRoom(roomId);

    if (room.members.size === 0) {
      rooms.delete(roomId);
      updateRooms();
    }
  }

  socket.leave(roomId);
  socket.data.roomId = null;
}

io.on("connection", socket => {

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
        createdAt: Date.now()
      };

      db.profiles[id] = profile;
    } else {
      profile.name = name;
    }

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

    if (typeof callback === "function") {
      callback({ ok: true, user });
    }

    io.emit("online-count", online.size);
  });

  socket.on("get-rooms", () => {
    socket.emit("room-list", getRoomList());
  });

  socket.on("create-room", (data, callback) => {
    const user = getUser(socket);

    if (!user) {
      callback?.({ ok: false, error: "Register first." });
      return;
    }

    const id = String(db.nextRoomId++);

    rooms.set(id, {
      id,
      name: clean(data?.name, 35) || `${user.name}'s Room`,
      ownerName: user.name,
      ownerId: user.id,
      members: new Set(),
      seats: Array(8).fill(null),
      messages: []
    });

    saveDB();

    callback?.({ ok: true, id });
    updateRooms();
  });

  socket.on("join-room", (data, callback) => {
    const user = getUser(socket);
    const id = clean(data?.roomId, 20);
    const room = rooms.get(id);

    if (!user || !room) {
      callback?.({ ok: false, error: "Room not found." });
      return;
    }

    if (socket.data.roomId) leaveRoom(socket);

    socket.join(id);
    socket.data.roomId = id;
    room.members.add(socket.id);

    callback?.({
      ok: true,
      room: {
        id: room.id,
        name: room.name,
        owner: room.ownerName
      },
      messages: room.messages,
      seats: room.seats
    });

    socket.to(id).emit("system-message", `${user.name} joined.`);
    socket.to(id).emit("voice-peer-joined", {
      socketId: socket.id
    });

    socket.emit(
      "voice-existing-peers",
      [...room.members].filter(peer => peer !== socket.id)
    );

    updateRoom(id);
  });

  socket.on("leave-room", () => leaveRoom(socket));

  socket.on("take-seat", (seatIndex, callback) => {
    const room = rooms.get(socket.data.roomId);
    const user = getUser(socket);
    const index = Number(seatIndex);

    if (!room || !user || !Number.isInteger(index) ||
        index < 0 || index > 7) {
      callback?.({ ok: false, error: "Invalid seat." });
      return;
    }

    const oldIndex = room.seats.findIndex(
      seat => seat?.socketId === socket.id
    );

    if (oldIndex !== -1) room.seats[oldIndex] = null;

    if (room.seats[index] !== null) {
      callback?.({ ok: false, error: "Seat is occupied." });
      updateRoom(room.id);
      return;
    }

    room.seats[index] = {
      socketId: socket.id,
      id: user.id,
      name: user.name
    };

    callback?.({ ok: true });
    updateRoom(room.id);
  });

  socket.on("leave-seat", () => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;

    room.seats = room.seats.map(seat =>
      seat?.socketId === socket.id ? null : seat
    );

    updateRoom(room.id);
  });

  socket.on("room-message", data => {
    const room = rooms.get(socket.data.roomId);
    const user = getUser(socket);
    const text = clean(data?.text, 500);

    if (!room || !user || !text) return;

    const message = {
      name: user.name,
      userId: user.id,
      text,
      time: Date.now()
    };

    room.messages.push(message);
    if (room.messages.length > 100) room.messages.shift();

    io.to(room.id).emit("room-message", message);
  });

  socket.on("send-gift", (data, callback) => {
    const room = rooms.get(socket.data.roomId);
    const user = getUser(socket);
    const gift = clean(data?.gift, 30);
    const cost = gifts[gift];
    const profile = getProfile(socket);

    if (!room || !user || !profile || !cost) {
      callback?.({ ok: false, error: "Invalid gift." });
      return;
    }

    if (profile.coins < cost) {
      callback?.({ ok: false, error: "Not enough coins." });
      return;
    }

    profile.coins -= cost;
    user.coins = profile.coins;

    saveDB();

    io.to(room.id).emit("gift-event", {
      from: user.name,
      gift,
      to: clean(data?.to, 30) || "Everyone",
      cost,
      time: Date.now()
    });

    callback?.({ ok: true, coins: profile.coins });
  });

  socket.on("send-dm", data => {
    const user = getUser(socket);
    const targetId = clean(data?.to, 20);
    const text = clean(data?.text, 500);

    if (!user || !targetId || !text || !db.profiles[targetId]) {
      socket.emit("dm-error", "User ID ya message sahi nahi hai.");
      return;
    }

    const target = db.profiles[targetId];

    const message = {
      from: user.name,
      fromId: user.id,
      to: target.name,
      toId: targetId,
      text,
      time: Date.now()
    };

    db.inbox[targetId] ||= [];
    db.inbox[user.id] ||= [];

    db.inbox[targetId].push(message);
    db.inbox[user.id].push(message);

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

    socket.emit("inbox-data", db.inbox[user.id] || []);
  });

  // WebRTC voice signaling
  socket.on("voice-offer", data => {
    if (data?.to && data?.offer) {
      io.to(data.to).emit("voice-offer", {
        from: socket.id,
        offer: data.offer
      });
    }
  });

  socket.on("voice-answer", data => {
    if (data?.to && data?.answer) {
      io.to(data.to).emit("voice-answer", {
        from: socket.id,
        answer: data.answer
      });
    }
  });

  socket.on("voice-ice", data => {
    if (data?.to && data?.candidate) {
      io.to(data.to).emit("voice-ice", {
        from: socket.id,
        candidate: data.candidate
      });
    }
  });

  socket.on("disconnect", () => {
    leaveRoom(socket);
    online.delete(socket.id);
    io.emit("online-count", online.size);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Huka Voice Chat running on port " + PORT);
  console.log("Public folder: " + PUBLIC_DIR);
});
