const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const rooms = {};

io.on("connection", (socket) => {
socket.on("joinRoom", ({ room, username }) => {
if (typeof room !== "string" || typeof username !== "string") return;

```
room = room.trim().slice(0, 40);
username = username.trim().slice(0, 24);

if (!room || !username) return;

if (socket.data.room) {
  socket.leave(socket.data.room);
  const oldRoom = rooms[socket.data.room];

  if (oldRoom) {
    oldRoom.delete(socket.id);
    io.to(socket.data.room).emit("members", [...oldRoom.values()]);
    if (oldRoom.size === 0) delete rooms[socket.data.room];
  }
}

if (!rooms[room]) rooms[room] = new Map();

socket.data.room = room;
socket.data.username = username;
rooms[room].set(socket.id, username);

socket.join(room);
io.to(room).emit("members", [...rooms[room].values()]);
socket.emit("joined", room);
```

});

socket.on("chatMessage", (message) => {
const room = socket.data.room;

```
if (!room || typeof message !== "string") return;

const text = message.trim().slice(0, 500);
if (!text) return;

io.to(room).emit("chatMessage", {
  username: socket.data.username,
  message: text
});
```

});

socket.on("disconnect", () => {
const room = socket.data.room;
if (!room || !rooms[room]) return;

```
rooms[room].delete(socket.id);
io.to(room).emit("members", [...rooms[room].values()]);

if (rooms[room].size === 0) delete rooms[room];
```

});
});

server.listen(PORT, "0.0.0.0", () => {
console.log(`Huka Voice Chat running on port ${PORT}`);
});
