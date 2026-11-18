const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

io.on("connection", (socket) => {

socket.on("joinRoom", (data) => {
const username = String(data.username || "").trim().slice(0, 20);
const room = String(data.room || "").trim().slice(0, 40);

```
if (!username || !room) return;

if (!rooms[room]) rooms[room] = {};

if (Object.keys(rooms[room]).length >= 8) {
  socket.emit("roomFull");
  return;
}

socket.data.room = room;
socket.data.username = username;

socket.join(room);
rooms[room][socket.id] = username;

io.to(room).emit("members", Object.values(rooms[room]));

io.to(room).emit("chatMessage", {
  username: "Huka Bot",
  message: username + " joined the room!"
});
```

});

socket.on("chatMessage", (message) => {
const room = socket.data.room;

```
if (!room || typeof message !== "string") return;

io.to(room).emit("chatMessage", {
  username: socket.data.username,
  message: message.slice(0, 250)
});
```

});

socket.on("leaveRoom", () => {
leaveRoom(socket);
});

function leaveRoom(s) {
const room = s.data.room;

```
if (!room || !rooms[room]) return;

delete rooms[room][s.id];

s.leave(room);

io.to(room).emit("members", Object.values(rooms[room]));

if (Object.keys(rooms[room]).length === 0) {
  delete rooms[room];
}

s.data.room = null;
```

}

socket.on("disconnect", () => {
leaveRoom(socket);
});

});

app.get("/health", (req, res) => {
res.json({ status: "online" });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
console.log("Huka Voice Chat running on " + PORT);
});
