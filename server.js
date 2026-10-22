```javascript
"use strict";

const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 10000;

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.json({ limit: "100kb" }));
app.use(express.static(__dirname));

/*
 * Huka Voice Chat
 * Initial real-time server foundation.
 *
 * Includes:
 * - Health endpoint
 * - Live room list
 * - Socket.IO room join/leave
 * - Live room chat
 * - Online user count
 *
 * Room and user data are stored in memory.
 * They reset when the server restarts.
 */

const users = new Map();
const rooms = new Map();
const socketUsers = new Map();

const DEFAULT_ROOM_ID = "200001";

function cleanText(value, maxLength = 80) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function safeRoomId(value) {
  const id = cleanText(String(value || ""), 24);
  return /^[a-zA-Z0-9_-]{1,24}$/.test(id) ? id : "";
}

function makeUserId() {
  return crypto.randomUUID();
}

function getRoom(roomId) {
  const id = safeRoomId(roomId);
  if (!id) return null;

  if (!rooms.has(id)) {
    rooms.set(id, {
      id,
      name: id === DEFAULT_ROOM_ID
        ? "Huka Friends Club"
        : "Huka Voice Room",
      category: "General",
      hostId: null,
      createdAt: Date.now(),
      members: new Map(),
      messages: []
    });
  }

  return rooms.get(id);
}

function publicRoom(room) {
  return {
    id: room.id,
    name: room.name,
    category: room.category,
    hostId: room.hostId,
    online: room.members.size,
    createdAt: room.createdAt
  };
}

function roomList() {
  return Array.from(rooms.values())
    .filter(room => room.members.size > 0)
    .map(publicRoom)
    .sort((a, b) => b.online - a.online);
}

function broadcastRoomList() {
  io.emit("rooms:list", roomList());
}

function getOnlineUsers() {
  return Array.from(users.values()).map(user => ({
    id: user.id,
    name: user.name,
    avatar: user.avatar,
    roomId: user.roomId
  }));
}

function broadcastRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  io.to(roomId).emit("room:state", {
    room: publicRoom(room),
    members: Array.from(room.members.values()).map(member => ({
      id: member.id,
      name: member.name,
      avatar: member.avatar,
      seat: member.seat
    }))
  });

  broadcastRoomList();
}

function leaveCurrentRoom(socket) {
  const user = socketUsers.get(socket.id);
  if (!user || !user.roomId) return;

  const oldRoomId = user.roomId;
  const room = rooms.get(oldRoomId);

  socket.leave(oldRoomId);
  user.roomId = null;

  if (room) {
    room.members.delete(socket.id);

    if (room.hostId === socket.id) {
      const nextMember = room.members.keys().next();

      room.hostId = nextMember.done
        ? null
        : nextMember.value;
    }

    socket.to(oldRoomId).emit("room:user-left", {
      userId: user.id,
      name: user.name
    });

    if (room.members.size === 0) {
      rooms.delete(oldRoomId);
    } else {
      broadcastRoomState(oldRoomId);
    }
  }

  socket.emit("room:left", { roomId: oldRoomId });
  broadcastRoomList();
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"), err => {
    if (err && !res.headersSent) {
      res.status(404).send("Huka Voice Chat: index.html not found.");
    }
  });
});

app.get("/health", (req, res) => {
  res.json({
    app: "Huka Voice Chat Server",
    status: "running",
    socketIO: true,
    onlineUsers: users.size,
    activeRooms: rooms.size,
    time: new Date().toISOString()
  });
});

app.get("/api/rooms", (req, res) => {
  res.json({
    success: true,
    rooms: roomList()
  });
});

app.get("/api/online-users", (req, res) => {
  res.json({
    success: true,
    count: users.size,
    users: getOnlineUsers()
  });
});

io.on("connection", socket => {
  const user = {
    id: makeUserId(),
    name: "Huka User",
    avatar: "👤",
    roomId: null
  };

  users.set(socket.id, user);
  socketUsers.set(socket.id, user);

  socket.emit("connected", {
    socketId: socket.id,
    userId: user.id,
    name: user.name
  });

  io.emit("users:count", users.size);
  socket.emit("rooms:list", roomList());

  /*
   * Register or update the display name and avatar.
   */
  socket.on("user:update", (data, callback) => {
    const currentUser = socketUsers.get(socket.id);
    if (!currentUser) return;

    data = data && typeof data === "object" ? data : {};

    const name = cleanText(data.name, 30);
    const avatar = cleanText(data.avatar, 500);

    if (name) currentUser.name = name;
    if (avatar) currentUser.avatar = avatar;

    users.set(socket.id, currentUser);

    if (currentUser.roomId) {
      const room = rooms.get(currentUser.roomId);

      if (room && room.members.has(socket.id)) {
        room.members.set(socket.id, {
          id: currentUser.id,
          name: currentUser.name,
          avatar: currentUser.avatar,
          seat: room.members.get(socket.id).seat
        });

        broadcastRoomState(currentUser.roomId);
      }
    }

    if (typeof callback === "function") {
      callback({
        success: true,
        user: {
          id: currentUser.id,
          name: currentUser.name,
          avatar: currentUser.avatar
        }
      });
    }

    io.emit("users:list", getOnlineUsers());
  });

  /*
   * Join a voice-room channel.
   * This is Socket.IO room membership, not audio calling by itself.
   */
  socket.on("room:join", (data, callback) => {
    const currentUser = socketUsers.get(socket.id);
    data = data && typeof data === "object" ? data : {};

    const roomId = safeRoomId(data.roomId || DEFAULT_ROOM_ID);

    if (!currentUser || !roomId) {
      if (typeof callback === "function") {
        callback({
          success: false,
          error: "Invalid room ID."
        });
      }
      return;
    }

    leaveCurrentRoom(socket);

    const room = getRoom(roomId);

    if (!room) {
      if (typeof callback === "function") {
        callback({
          success: false,
          error: "Unable to open room."
        });
      }
      return;
    }

    const requestedName = cleanText(data.roomName, 50);
    const requestedCategory = cleanText(data.category, 20);

    if (requestedName && room.members.size === 0) {
      room.name = requestedName;
    }

    if (
      ["General", "Music", "Friends", "Gaming", "Event"].includes(
        requestedCategory
      ) &&
      room.members.size === 0
    ) {
      room.category = requestedCategory;
    }

    currentUser.roomId = roomId;

    const seat = room.members.size === 0
      ? 0
      : room.members.size;

    room.members.set(socket.id, {
      id: currentUser.id,
      name: currentUser.name,
      avatar: currentUser.avatar,
      seat
    });

    if (!room.hostId) {
      room.hostId = socket.id;
    }

    socket.join(roomId);

    socket.emit("room:joined", {
      room: publicRoom(room),
      messages: room.messages.slice(-50)
    });

    socket.to(roomId).emit("room:user-joined", {
      id: currentUser.id,
      name: currentUser.name,
      avatar: currentUser.avatar
    });

    broadcastRoomState(roomId);

    if (typeof callback === "function") {
      callback({
        success: true,
        room: publicRoom(room)
      });
    }
  });

  /*
   * Leave the current room.
   */
  socket.on("room:leave", () => {
    leaveCurrentRoom(socket);
  });

  /*
   * Send a live text message to the current room.
   */
  socket.on("chat:send", (data, callback) => {
    const currentUser = socketUsers.get(socket.id);
    data = data && typeof data === "object" ? data : {};

    if (!currentUser || !currentUser.roomId) {
      if (typeof callback === "function") {
        callback({
          success: false,
          error: "Join a room before sending a message."
        });
      }
      return;
    }

    const text = cleanText(data.text, 500);

    if (!text) {
      if (typeof callback === "function") {
        callback({
          success: false,
          error: "Message cannot be empty."
        });
      }
      return;
    }

    const room = rooms.get(currentUser.roomId);
    if (!room) return;

    const message = {
      id: makeUserId(),
      userId: currentUser.id,
      name: currentUser.name,
      avatar: currentUser.avatar,
      text,
      createdAt: Date.now()
    };

    room.messages.push(message);

    if (room.messages.length > 100) {
      room.messages.splice(0, room.messages.length - 100);
    }

    io.to(room.id).emit("chat:message", message);

    if (typeof callback === "function") {
      callback({
        success: true,
        message
      });
    }
  });

  /*
   * Example gift notification.
   * This only broadcasts a demo gift event; it does not deduct coins.
   */
  socket.on("gift:send", (data, callback) => {
    const currentUser = socketUsers.get(socket.id);
    data = data && typeof data === "object" ? data : {};

    if (!currentUser || !currentUser.roomId) {
      if (typeof callback === "function") {
        callback({
          success: false,
          error: "Join a room before sending a gift."
        });
      }
      return;
    }

    const giftName = cleanText(data.giftName, 40);

    if (!giftName) {
      if (typeof callback === "function") {
        callback({
          success: false,
          error: "Enter a gift name."
        });
      }
      return;
    }

    const gift = {
      id: makeUserId(),
      senderId: currentUser.id,
      senderName: currentUser.name,
      giftName,
      createdAt: Date.now()
    };

    io.to(currentUser.roomId).emit("gift:received", gift);

    if (typeof callback === "function") {
      callback({
        success: true,
        gift
      });
    }
  });

  socket.on("disconnect", () => {
    leaveCurrentRoom(socket);

    users.delete(socket.id);
    socketUsers.delete(socket.id);

    io.emit("users:count", users.size);
    io.emit("users:list", getOnlineUsers());
    broadcastRoomList();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Huka Voice Chat server running on port " + PORT);
});
```
