const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, "huka-data.json");

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

const giftList = {
  Rose: 10,
  Heart: 50,
  Crown: 100,
  Diamond: 500,
  Rocket: 1000
};

function clean(value, max = 100) {
  return String(value || "").trim().slice(0, max);
}

function profileFor(socket) {
  return db.profiles[socket.data.userId];
}

function onlineCount() {
  return online.size;
}

function roomList() {
  return [...rooms.values()].map(room => ({
    id: room.id,
    name: room.name,
    owner: room.ownerName,
    members: room.members.size,
    seats: room.seats
  }));
}

function updateRooms() {
  io.emit("room-list", roomList());
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

    socket.to(roomId).emit("system-message",
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
    let profileId = clean(data?.profileId, 20);

    let profile = db.profiles[profileId];

    if (!profile) {
      profileId = String(db.nextUserId++);
      profile = {
        id: profileId,
        name,
        coins: 1000,
        diamonds: 0,
        level: 1,
        createdAt: Date.now()
      };
      db.profiles[profileId] = profile;
    } else {
      profile.name = name;
    }

    socket.data.userId = profileId;
    socket.data.name = name;

    const user = {
      id: profileId,
      name,
      coins: profile.coins,
      diamonds: profile.diamonds,
      level: profile.level,
      socketId: socket.id
    };

    online.set(socket.id, user);
    saveDB();

    if (typeof callback === "function") {
      callback({ ok: true, user });
    }

    io.emit("online-count", onlineCount());
  });

  socket.on("get-rooms", () => {
    socket.emit("room-list", roomList());
  });

  socket.on("create-room", (data, callback) => {
    const user = online.get(socket.id);

    if (!user) {
      callback?.({ ok: false, error: "Register first." });
      return;
    }

    const id = String(db.nextRoomId++);

    rooms.set(id, {
      id,
      name: clean(data?.name, 35) || `${user.name}'s Room`,
      ownerId: user.id,
      ownerName: user.name,
      members: new Set(),
      seats: Array(8).fill(null),
      messages: []
    });

    saveDB();

    callback?.({ ok: true, id });
    updateRooms();
  });

  socket.on("join-room", (data, callback) => {
    const user = online.get(socket.id);
    const roomId = clean(data?.roomId, 20);
    const room = rooms.get(roomId);

    if (!user || !room) {
      callback?.({ ok: false, error: "Room not found." });
      return;
    }

    if (socket.data.roomId) leaveRoom(socket);

    socket.join(roomId);
    socket.data.roomId = roomId;
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

    socket.to(roomId).emit("system-message", `${user.name} joined.`);
    updateRoom(roomId);

    // Tell existing users to create voice connections.
    socket.to(roomId).emit("voice-peer-joined", {
      socketId: socket.id
    });

    socket.emit("voice-existing-peers",
      [...room.members].filter(id => id !== socket.id)
    );
  });

  socket.on("leave-room", () => leaveRoom(socket));

  socket.on("take-seat", (seatIndex, callback) => {
    const room = rooms.get(socket.data.roomId);
    const user = online.get(socket.id);
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
    const user = online.get(socket.id);
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
    const user = online.get(socket.id);
    const gift = clean(data?.gift, 30);
    const cost = giftList[gift];

    if (!room || !user || !cost) {
      callback?.({ ok: false, error: "Invalid gift." });
      return;
    }

    const profile = profileFor(socket);

    if (!profile || profile.coins < cost) {
      callback?.({ ok: false, error: "Not enough coins." });
      return;
    }

    profile.coins -= cost;
    user.coins = profile.coins;
    saveDB();

    const event = {
      from: user.name,
      gift,
      to: clean(data?.to, 30) || "Everyone",
      cost,
      coins: profile.coins,
      time: Date.now()
    };

    io.to(room.id).emit("gift-event", event);
    callback?.({ ok: true, coins: profile.coins });
  });

  socket.on("send-dm", data => {
    const user = online.get(socket.id);
    if (!user) return;

    const targetId = clean(data?.to, 20);
    const text = clean(data?.text, 500);
    const targetProfile = db.profiles[targetId];

    if (!targetProfile || !text) {
      socket.emit("dm-error", "User ID ya message sahi nahi hai.");
      return;
    }

    const item = {
      from: user.name,
      fromId: user.id,
      to: targetProfile.name,
      toId: targetId,
      text,
      time: Date.now()
    };

    db.inbox[targetId] ||= [];
    db.inbox[user.id] ||= [];

    db.inbox[targetId].push(item);
    db.inbox[user.id].push(item);

    saveDB();

    const targetSocketId = [...online.entries()]
      .find(([, u]) => u.id === targetId)?.[0];

    if (targetSocketId) {
      io.to(targetSocketId).emit("new-dm", item);
    }

    socket.emit("dm-sent", item);
  });

  socket.on("get-inbox", () => {
    const user = online.get(socket.id);
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
    io.emit("online-count", onlineCount());
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, app: "Huka Voice Chat" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Huka Voice Chat running on port " + PORT);
});
