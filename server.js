javascript
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

let users = {};
let rooms = {};
let messages = {};
let inbox = {};

function makeId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function getOnlineCount() {
  return Object.keys(users).length;
}

function getRoomList() {
  return Object.values(rooms).map(room => ({
    id: room.id,
    name: room.name,
    owner: room.owner,
    members: room.members.length,
    seats: room.seats
  }));
}

function sendRoomUpdate(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  io.to(roomId).emit("seats-update", room.seats);

  io.to(roomId).emit("members-update", {
    members: room.members.map(id => users[id]).filter(Boolean)
  });
}

io.on("connection", socket => {

  socket.on("register", (data, callback) => {
    const name = String(data?.name || "Huka User").trim().slice(0, 20);

    users[socket.id] = {
      socketId: socket.id,
      name,
      profileId: makeId()
    };

    if (typeof callback === "function") {
      callback({ ok: true, user: users[socket.id] });
    }

    io.emit("online-count", getOnlineCount());
  });

  socket.on("get-rooms", () => {
    socket.emit("room-list", getRoomList());
  });

  socket.on("create-room", (data, callback) => {
    const user = users[socket.id];

    if (!user) {
      if (typeof callback === "function") callback({ ok: false, error: "Please register first." });
      return;
    }

    const id = makeId();

    rooms[id] = {
      id,
      name: String(data?.name || `${user.name}'s Room`).trim().slice(0, 35),
      owner: user.name,
      members: [],
      seats: Array(8).fill(null)
    };

    messages[id] = [];

    if (typeof callback === "function") {
      callback({ ok: true, id });
    }

    io.emit("room-list", getRoomList());
  });

  socket.on("join-room", (data, callback) => {
    const roomId = String(data?.roomId || "");
    const room = rooms[roomId];
    const user = users[socket.id];

    if (!room || !user) {
      if (typeof callback === "function") {
        callback({ ok: false, error: "Room not found. Please try again." });
      }
      return;
    }

    if (socket.data.roomId) {
      leaveRoom(socket);
    }

    socket.join(roomId);
    socket.data.roomId = roomId;

    if (!room.members.includes(socket.id)) {
      room.members.push(socket.id);
    }

    if (typeof callback === "function") {
      callback({
        ok: true,
        room,
        messages: messages[roomId] || [],
        seats: room.seats
      });
    }

    io.to(roomId).emit("system-message", `${user.name} joined the room.`);
    sendRoomUpdate(roomId);
    io.emit("room-list", getRoomList());
  });

  socket.on("take-seat", (seatIndex, callback) => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    const user = users[socket.id];
    const index = Number(seatIndex);

    if (!room || !user || !Number.isInteger(index) || index < 0 || index >= 8) {
      if (typeof callback === "function") callback({ ok: false, error: "Seat unavailable." });
      return;
    }

    const occupied = room.seats.findIndex(seat => seat?.socketId === socket.id);

    if (occupied !== -1) {
      room.seats[occupied] = null;
    }

    if (room.seats[index] !== null) {
      if (typeof callback === "function") callback({ ok: false, error: "This seat is already taken." });
      return;
    }

    room.seats[index] = {
      socketId: socket.id,
      name: user.name
    };

    sendRoomUpdate(roomId);

    if (typeof callback === "function") callback({ ok: true });
  });

  socket.on("leave-seat", () => {
    const room = rooms[socket.data.roomId];
    if (!room) return;

    room.seats = room.seats.map(seat =>
      seat?.socketId === socket.id ? null : seat
    );

    sendRoomUpdate(room.id);
  });

  socket.on("room-message", data => {
    const roomId = socket.data.roomId;
    const user = users[socket.id];
    const room = rooms[roomId];

    if (!room || !user) return;

    const message = String(data?.text || "").trim().slice(0, 500);
    if (!message) return;

    const item = {
      name: user.name,
      text: message,
      time: Date.now()
    };

    messages[roomId].push(item);
    if (messages[roomId].length > 100) messages[roomId].shift();

    io.to(roomId).emit("room-message", item);
  });

  socket.on("send-gift", data => {
    const roomId = socket.data.roomId;
    const user = users[socket.id];
    if (!rooms[roomId] || !user) return;

    const gift = {
      from: user.name,
      gift: String(data?.gift || "Gift").slice(0, 30),
      to: String(data?.to || "Everyone").slice(0, 30),
      time: Date.now()
    };

    io.to(roomId).emit("gift-event", gift);
  });

  socket.on("send-dm", data => {
    const user = users[socket.id];
    if (!user) return;

    const to = String(data?.to || "").trim();
    const text = String(data?.text || "").trim().slice(0, 500);

    if (!to || !text) {
      socket.emit("dm-error", "Enter a user ID and message.");
      return;
    }

    const target = Object.values(users).find(u => u.profileId === to);

    if (!target) {
      socket.emit("dm-error", "User is not online.");
      return;
    }

    const item = {
      from: user.name,
      fromId: user.profileId,
      to: target.name,
      text,
      time: Date.now()
    };

    inbox[target.profileId] ||= [];
    inbox[target.profileId].push(item);

    inbox[user.profileId] ||= [];
    inbox[user.profileId].push(item);

    const targetSocket = io.sockets.sockets.get(target.socketId);
    if (targetSocket) targetSocket.emit("new-dm", item);

    socket.emit("dm-sent", item);
  });

  socket.on("get-inbox", () => {
    const user = users[socket.id];
    if (!user) return;

    socket.emit("inbox-data", inbox[user.profileId] || []);
  });

  socket.on("report-user", data => {
    const user = users[socket.id];
    if (!user) return;

    console.log("User report:", {
      reporter: user.profileId,
      reportedUser: String(data?.userId || "").slice(0, 30),
      reason: String(data?.reason || "Not specified").slice(0, 200)
    });
  });

  function leaveRoom(currentSocket) {
    const roomId = currentSocket.data.roomId;
    const room = rooms[roomId];

    if (!room) {
      currentSocket.data.roomId = null;
      return;
    }

    room.members = room.members.filter(id => id !== currentSocket.id);

    room.seats = room.seats.map(seat =>
      seat?.socketId === currentSocket.id ? null : seat
    );

    currentSocket.leave(roomId);
    currentSocket.data.roomId = null;

    sendRoomUpdate(roomId);

    const user = users[currentSocket.id];
    if (user) io.to(roomId).emit("system-message", `${user.name} left the room.`);

    io.emit("room-list", getRoomList());
  }

  socket.on("leave-room", () => leaveRoom(socket));

  socket.on("disconnect", () => {
    leaveRoom(socket);
    delete users[socket.id];

    io.emit("online-count", getOnlineCount());
    io.emit("room-list", getRoomList());
  });

});

app.get("/health", (req, res) => {
  res.json({ ok: true, app: "Huka Voice Chat" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Huka Voice Chat running on port ${PORT}`);
});
