const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

io.on("connection", (socket) => {

  socket.on("joinRoom", (data = {}) => {
    let { room, username } = data;

    if (
      typeof room !== "string" ||
      typeof username !== "string" ||
      !room.trim() ||
      !username.trim()
    ) return;

    room = room.trim().slice(0, 40);
    username = username.trim().slice(0, 20);

    leaveRoom();

    socket.data.room = room;
    socket.data.username = username;

    socket.join(room);

    if (!rooms[room]) rooms[room] = {};

    // Existing members ko naye member ki information
    const existingUsers = Object.entries(rooms[room]).map(
      ([id, name]) => ({ id, username: name })
    );

    rooms[room][socket.id] = username;

    socket.emit("roomUsers", existingUsers);

    socket.to(room).emit("user-joined", {
      id: socket.id,
      username
    });

    io.to(room).emit(
      "members",
      Object.values(rooms[room])
    );

    socket.to(room).emit("chatMessage", {
      username: "Huka Bot",
      message: username + " room mein aa gaya!"
    });
  });

  // WebRTC offer
  socket.on("voice-offer", ({ target, offer } = {}) => {
    const room = socket.data.room;

    if (!room || !target || !offer) return;
    if (io.sockets.sockets.get(target)?.data.room !== room) return;

    io.to(target).emit("voice-offer", {
      from: socket.id,
      offer
    });
  });

  // WebRTC answer
  socket.on("voice-answer", ({ target, answer } = {}) => {
    const room = socket.data.room;

    if (!room || !target || !answer) return;
    if (io.sockets.sockets.get(target)?.data.room !== room) return;

    io.to(target).emit("voice-answer", {
      from: socket.id,
      answer
    });
  });

  // WebRTC ICE candidate
  socket.on("voice-ice", ({ target, candidate } = {}) => {
    const room = socket.data.room;

    if (!room || !target || !candidate) return;
    if (io.sockets.sockets.get(target)?.data.room !== room) return;

    io.to(target).emit("voice-ice", {
      from: socket.id,
      candidate
    });
  });

  // Text chat
  socket.on("chatMessage", (message) => {
    const room = socket.data.room;
    const username = socket.data.username;

    if (
      !room ||
      !username ||
      typeof message !== "string" ||
      !message.trim()
    ) return;

    io.to(room).emit("chatMessage", {
      username,
      message: message.trim().slice(0, 300)
    });
  });

  function leaveRoom() {
    const room = socket.data.room;

    if (room && rooms[room]) {
      delete rooms[room][socket.id];

      socket.to(room).emit("user-left", {
        id: socket.id
      });

      socket.leave(room);

      io.to(room).emit(
        "members",
        Object.values(rooms[room])
      );

      if (Object.keys(rooms[room]).length === 0) {
        delete rooms[room];
      }
    }

    delete socket.data.room;
    delete socket.data.username;
  }

  socket.on("leaveRoom", leaveRoom);
  socket.on("disconnect", leaveRoom);
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("Huka Voice Chat running on port " + PORT);
});
