const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

io.on("connection", (socket) => {
socket.on("joinRoom", ({ room, username }) => {
if (
typeof room !== "string" ||
typeof username !== "string" ||
!room.trim() ||
!username.trim()
) {
return;
}

```
room = room.trim().slice(0, 40);
username = username.trim().slice(0, 20);

socket.data.room = room;
socket.data.username = username;

socket.join(room);

if (!rooms[room]) rooms[room] = {};
rooms[room][socket.id] = username;

io.to(room).emit("members", Object.values(rooms[room]));
socket.to(room).emit("chatMessage", {
  username: "Huka Bot",
  message: `${username} room mein aa gaya!`
});
```

});

socket.on("chatMessage", (message) => {
const room = socket.data.room;
const username = socket.data.username;

```
if (
  !room ||
  !username ||
  typeof message !== "string" ||
  !message.trim()
) {
  return;
}

io.to(room).emit("chatMessage", {
  username,
  message: message.trim().slice(0, 300)
});
```

});

function leaveRoom() {
const room = socket.data.room;

```
if (room && rooms[room]) {
  delete rooms[room][socket.id];
  socket.leave(room);
  io.to(room).emit("members", Object.values(rooms[room]));

  if (Object.keys(rooms[room]).length === 0) {
    delete rooms[room];
  }
}

delete socket.data.room;
delete socket.data.username;
```

}

socket.on("leaveRoom", leaveRoom);
socket.on("disconnect", leaveRoom);
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
console.log(`Huka Voice Chat server running on port ${PORT}`);
});
