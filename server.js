const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server);

app.use(express.static("public"));

app.get("/", (req, res) => {
res.sendFile(__dirname + "/public/index.html");
});

const rooms = {};

io.on("connection", (socket) => {
console.log("User connected:", socket.id);

socket.on("joinRoom", ({ room, username }) => {
if (
typeof room !== "string" ||
typeof username !== "string"
) {
return;
}

room = room.trim().slice(0, 40);
username = username.trim().slice(0, 20);

if (!room || !username) return;

if (socket.data.room) {
  leaveRoom(socket);
}

socket.data.room = room;
socket.data.username = username;

socket.join(room);

if (!rooms[room]) {
  rooms[room] = {};
}

rooms[room][socket.id] = username;

const members = Object.entries(rooms[room]).map(
  ([id, name]) => ({
    id,
    username: name
  })
);

io.to(room).emit("members", members);

socket.to(room).emit("user-joined", {
  id: socket.id,
  username
});

socket.emit("chatMessage", {
  username: "Huka Bot",
  message: `Welcome ${username}!`
});

});

socket.on("chatMessage", (message) => {
const room = socket.data.room;

if (!room || typeof message !== "string") return;

message = message.trim().slice(0, 500);

if (!message) return;

io.to(room).emit("chatMessage", {
  username: socket.data.username,
  message
});

});

socket.on("voice-offer", ({ to, offer }) => {
sendToRoomMember(socket, to, "voice-offer", {
from: socket.id,
offer
});
});

socket.on("voice-answer", ({ to, answer }) => {
sendToRoomMember(socket, to, "voice-answer", {
from: socket.id,
answer
});
});

socket.on("voice-ice", ({ to, candidate }) => {
sendToRoomMember(socket, to, "voice-ice", {
from: socket.id,
candidate
});
});

socket.on("disconnect", () => {
leaveRoom(socket);
console.log("User disconnected:", socket.id);
});
});

function sendToRoomMember(socket, targetId, event, data) {
const room = socket.data.room;

if (!room || !targetId || !rooms[room]) return;
if (!rooms[room][targetId]) return;

io.to(targetId).emit(event, data);
}

function leaveRoom(socket) {
const room = socket.data.room;

if (!room || !rooms[room]) return;

delete rooms[room][socket.id];

socket.to(room).emit("user-left", {
id: socket.id
});

socket.leave(room);

if (Object.keys(rooms[room]).length === 0) {
delete rooms[room];
} else {
const members = Object.entries(rooms[room]).map(
([id, name]) => ({
id,
username: name
})
);

io.to(room).emit("members", members);

}

socket.data.room = null;
socket.data.username = null;
}

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
console.log(`Huka Voice Chat running on port ${PORT}`);
});
