const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const users = new Map();
const rooms = new Map();
const inbox = new Map();

function clean(value, max = 200) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, max);
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      name: "Huka Voice Room",
      owner: null,
      seats: Array(8).fill(null),
      members: new Map(),
      messages: []
    });
  }
  return rooms.get(roomId);
}

function publicRooms() {
  return [...rooms.values()].map(r => ({
    id: r.id,
    name: r.name,
    count: r.members.size,
    seats: r.seats.map(Boolean),
    owner: r.owner
  }));
}

function sendRooms() {
  io.emit("room-list", publicRooms());
}

function sendMembers(room) {
  io.to(room.id).emit("members", [...room.members.values()]);
}

function leaveRoom(socket) {
  const id = socket.data.roomId;
  if (!id) return;

  const room = rooms.get(id);
  if (room) {
    room.members.delete(socket.id);

    room.seats = room.seats.map(
      seat => seat === socket.id ? null : seat
    );

    if (room.owner === socket.id) {
      room.owner = room.members.keys().next().value || null;
    }

    socket.to(id).emit("system-message", "A member left.");

    sendMembers(room);
    io.to(id).emit("seats-update", room.seats.map(Boolean));

    if (!room.members.size) {
      rooms.delete(id);
    }
  }

  socket.leave(id);
  socket.data.roomId = null;
  socket.data.seat = null;

  sendRooms();
}

io.on("connection", socket => {

  socket.on("register", (data, callback = () => {}) => {
    const name = clean(data.name, 20);

    if (!name) {
      return callback({ ok: false, error: "Enter your name." });
    }

    const user = {
      id: socket.id,
      name,
      profileId: "HK" + Math.floor(100000 + Math.random() * 900000),
      online: true,
      level: 1,
      coins: 100
    };

    users.set(socket.id, user);
    socket.data.name = name;

    callback({ ok: true, user });
    io.emit("online-count", users.size);
    sendRooms();
  });

  socket.on("get-rooms", () => {
    socket.emit("room-list", publicRooms());
  });

  socket.on("create-room", (data, callback = () => {}) => {
    const name = clean(data.name, 35);
    const id = "R" + Math.floor(10000 + Math.random() * 90000);

    if (!socket.data.name) {
      return callback({ ok: false, error: "Register first." });
    }

    const room = getRoom(id);
    room.name = name || "New Huka Room";
    room.owner = socket.id;

    callback({ ok: true, id });
    sendRooms();
  });

  socket.on("join-room", (data, callback = () => {}) => {
    const id = clean(data.roomId, 20);

    if (!socket.data.name) {
      return callback({ ok: false, error: "Register first." });
    }

    leaveRoom(socket);

    const room = getRoom(id);

    if (room.members.size >= 8) {
      return callback({ ok: false, error: "Room is full." });
    }

    room.members.set(socket.id, {
      id: socket.id,
      name: socket.data.name
    });

    if (!room.owner) room.owner = socket.id;

    socket.join(id);
    socket.data.roomId = id;

    callback({
      ok: true,
      room: {
        id: room.id,
        name: room.name,
        owner: room.owner
      },
      seats: room.seats.map(Boolean),
      messages: room.messages.slice(-40)
    });

    sendMembers(room);
    sendRooms();

    io.to(id).emit("system-message", socket.data.name + " joined.");
  });

  socket.on("leave-room", () => leaveRoom(socket));

  socket.on("take-seat", (seatIndex, callback = () => {}) => {
    const room = rooms.get(socket.data.roomId);
    const index = Number(seatIndex);

    if (!room || !Number.isInteger(index) || index < 0 || index > 7) {
      return callback({ ok: false, error: "Invalid seat." });
    }

    if (room.seats[index] && room.seats[index] !== socket.id) {
      return callback({ ok: false, error: "Seat already occupied." });
    }

    room.seats = room.seats.map(
      seat => seat === socket.id ? null : seat
    );

    room.seats[index] = socket.id;
    socket.data.seat = index;

    io.to(room.id).emit("seats-update", room.seats.map(Boolean));

    callback({ ok: true });
  });

  socket.on("leave-seat", () => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;

    room.seats = room.seats.map(
      seat => seat === socket.id ? null : seat
    );

    socket.data.seat = null;

    io.to(room.id).emit("seats-update", room.seats.map(Boolean));
  });

  socket.on("room-message", raw => {
    const room = rooms.get(socket.data.roomId);
    const message = clean(raw, 250);

    if (!room || !message) return;

    const item = {
      name: socket.data.name,
      message,
      time: new Date().toLocaleTimeString()
    };

    room.messages.push(item);
    room.messages = room.messages.slice(-100);

    io.to(room.id).emit("room-message", item);
  });

  socket.on("send-gift", data => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;

    const gift = clean(data.gift, 20);
    const allowed = ["Rose", "Heart", "Star", "Crown"];

    if (!allowed.includes(gift)) return;

    const item = {
      from: socket.data.name,
      gift,
      to: clean(data.to, 30)
    };

    io.to(room.id).emit("gift-event", item);
  });

  socket.on("send-dm", data => {
    const to = clean(data.to, 100);
    const message = clean(data.message, 500);

    if (!message || !to) return;

    const target = [...users.values()].find(
      user => user.profileId === to
    );

    if (!target) return;

    const item = {
      from: socket.data.name,
      message,
      time: new Date().toLocaleTimeString()
    };

    if (!inbox.has(target.id)) inbox.set(target.id, []);
    inbox.get(target.id).push(item);

    io.to(target.id).emit("new-dm", item);
    socket.emit("dm-sent", item);
  });

  socket.on("get-inbox", () => {
    socket.emit("inbox-data", inbox.get(socket.id) || []);
  });

  socket.on("report-user", data => {
    console.log("Report received:", {
      reporter: socket.data.name,
      reason: clean(data.reason, 150)
    });

    socket.emit("report-received");
  });

  socket.on("disconnect", () => {
    leaveRoom(socket);
    users.delete(socket.id);

    io.emit("online-count", users.size);
    sendRooms();
  });

});

app.get("/health", (req, res) => {
  res.json({ status: "online", app: "Huka Voice Chat" });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("HUKA VOICE CHAT RUNNING ON " + PORT);
});
