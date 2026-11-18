const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const dataDir = path.join(__dirname, "data");
const counterFile = path.join(dataDir, "counter.json");

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(counterFile)) {
    fs.writeFileSync(
        counterFile,
        JSON.stringify({ nextId: 100011 }, null, 2)
    );
}

function generateId() {
    const data = JSON.parse(
        fs.readFileSync(counterFile, "utf8")
    );

    const id = data.nextId;

    data.nextId++;

    fs.writeFileSync(
        counterFile,
        JSON.stringify(data, null, 2)
    );

    return String(id);
}

const users = new Map();
const rooms = new Map();

function cleanText(value, maxLength) {
    return String(value || "")
        .trim()
        .slice(0, maxLength);
}

function validId(value) {
    return /^\d{6,12}$/.test(String(value));
}

// Create profile
app.post("/api/profile", (req, res) => {
    const username = cleanText(req.body.username, 20);

    if (username.length < 2) {
        return res.status(400).json({
            error: "Username must have at least 2 characters."
        });
    }

    const id = generateId();

    const profile = {
        profileId: id,
        roomId: id,
        username,
        createdAt: new Date().toISOString()
    };

    users.set(id, profile);

    res.json({
        success: true,
        profile
    });
});

// Get profile
app.get("/api/profile/:id", (req, res) => {
    const profile = users.get(req.params.id);

    if (!profile) {
        return res.status(404).json({
            error: "Profile not found."
        });
    }

    res.json(profile);
});

// Room information
function getRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, new Map());
    }

    return rooms.get(roomId);
}

function roomMembers(roomId) {
    const room = getRoom(roomId);

    return Array.from(room.values());
}

io.on("connection", (socket) => {

    console.log("Connected:", socket.id);

    socket.on("joinRoom", (data, callback) => {

        const profileId = cleanText(data.profileId, 12);
        const username = cleanText(data.username, 20);
        const roomId = cleanText(data.roomId, 12);

        if (
            !validId(profileId) ||
            !validId(roomId) ||
            !username ||
            !users.has(profileId)
        ) {
            if (callback) {
                callback({
                    success: false,
                    error: "Invalid profile or room ID."
                });
            }
            return;
        }

        // Leave previous room
        if (socket.data.roomId) {
            leaveRoom(socket);
        }

        const room = getRoom(roomId);

        socket.data.profileId = profileId;
        socket.data.username = username;
        socket.data.roomId = roomId;
        socket.data.inVoice = false;

        socket.join(roomId);

        room.set(socket.id, {
            profileId,
            username,
            socketId: socket.id,
            inVoice: false
        });

        io.to(roomId).emit(
            "members",
            roomMembers(roomId)
        );

        io.to(roomId).emit("chatMessage", {
            username: "Huka Bot",
            message: username + " joined the room.",
            time: new Date().toISOString()
        });

        if (callback) {
            callback({
                success: true,
                members: roomMembers(roomId)
            });
        }
    });

    // Chat
    socket.on("sendMessage", (message) => {

        const roomId = socket.data.roomId;

        if (!roomId) return;

        const text = cleanText(message, 500);

        if (!text) return;

        io.to(roomId).emit("chatMessage", {
            username: socket.data.username,
            profileId: socket.data.profileId,
            message: text,
            time: new Date().toISOString()
        });
    });

    // Voice chat: join
    socket.on("voice:join", () => {

        const roomId = socket.data.roomId;

        if (!roomId) return;

        const room = getRoom(roomId);

        const peers = Array.from(room.entries())
            .filter(([id, member]) =>
                id !== socket.id && member.inVoice
            )
            .map(([id, member]) => ({
                socketId: id,
                username: member.username
            }));

        socket.data.inVoice = true;

        const current = room.get(socket.id);

        if (current) {
            current.inVoice = true;
        }

        socket.emit("voice:peer-list", peers);

        io.to(roomId).emit(
            "members",
            roomMembers(roomId)
        );
    });

    // Voice chat: leave
    socket.on("voice:leave", () => {

        const roomId = socket.data.roomId;

        if (!roomId) return;

        socket.data.inVoice = false;

        const room = getRoom(roomId);
        const member = room.get(socket.id);

        if (member) {
            member.inVoice = false;
        }

        socket.to(roomId).emit(
            "voice:peer-left",
            socket.id
        );

        io.to(roomId).emit(
            "members",
            roomMembers(roomId)
        );
    });

    // WebRTC signaling
    socket.on("voice:signal", (data) => {

        if (
            !socket.data.roomId ||
            !socket.data.inVoice ||
            !data ||
            typeof data.target !== "string"
        ) {
            return;
        }

        const room = getRoom(socket.data.roomId);
        const target = room.get(data.target);

        if (!target || !target.inVoice) return;

        io.to(data.target).emit("voice:signal", {
            sender: socket.id,
            signal: data.signal
        });
    });

    // Leave room
    function leaveRoom(currentSocket) {

        const roomId = currentSocket.data.roomId;

        if (!roomId) return;

        const room = getRoom(roomId);

        room.delete(currentSocket.id);

        currentSocket.to(roomId).emit(
            "voice:peer-left",
            currentSocket.id
        );

        currentSocket.leave(roomId);

        io.to(roomId).emit(
            "members",
            roomMembers(roomId)
        );

        if (room.size === 0) {
            rooms.delete(roomId);
        }

        currentSocket.data.roomId = null;
    }

    socket.on("leaveRoom", () => {
        leaveRoom(socket);
    });

    // Demo gifts (no real-money purchases)
    socket.on("sendGift", (gift) => {

        const roomId = socket.data.roomId;

        if (!roomId) return;

        const allowedGifts = [
            "Rose",
            "Heart",
            "Star",
            "Diamond"
        ];

        if (!allowedGifts.includes(gift)) return;

        io.to(roomId).emit("giftReceived", {
            username: socket.data.username,
            gift
        });
    });

    socket.on("disconnect", () => {

        if (socket.data.roomId) {
            leaveRoom(socket);
        }

        console.log("Disconnected:", socket.id);
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log("Huka Voice Chat running on port " + PORT);
});
