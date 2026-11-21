"use strict";

/* =========================================
   HUKA VOICE CHAT - SERVER
   Express + Socket.IO
========================================= */

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  maxHttpBufferSize: 1e6
});

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DB_FILE = path.join(__dirname, "huka-data.json");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    app: "Huka Voice Chat",
    status: "running"
  });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/config", (req, res) => {
  res.json({
    ok: true,
    managerUrl: process.env.MANAGER_URL || ""
  });
});

/* =========================================
   DATABASE
========================================= */

let db = {
  nextUserId: 100001,
  nextRoomId: 100001,
  profiles: {},
  inbox: {}
};

try {
  if (fs.existsSync(DB_FILE)) {
    const saved = JSON.parse(
      fs.readFileSync(DB_FILE, "utf8")
    );

    db = {
      ...db,
      ...saved,
      profiles: saved.profiles || {},
      inbox: saved.inbox || {}
    };
  }
} catch (error) {
  console.error("Database load error:", error.message);
}

function saveDB() {
  try {
    const temp = DB_FILE + ".tmp";

    fs.writeFileSync(
      temp,
      JSON.stringify(db, null, 2)
    );

    fs.renameSync(temp, DB_FILE);
  } catch (error) {
    console.error("Database save error:", error.message);
  }
}

/* =========================================
   CONSTANTS
========================================= */

const ALLOWED_SEATS = [9, 11, 15, 20];

const GIFT_CATEGORIES = [
  "All",
  "Lucky",
  "VIP",
  "Love",
  "Royal",
  "Festival",
  "Special"
];

/*
  500 gifts generated from 50 names and
  10 price levels. Every gift has a unique ID.
*/

const GIFT_NAMES = [
  ["Rose", "🌹", "Love"],
  ["Heart", "❤️", "Love"],
  ["Love", "💕", "Love"],
  ["Kiss", "😘", "Love"],
  ["Teddy", "🧸", "Love"],
  ["Ring", "💍", "Love"],
  ["Love Letter", "💌", "Love"],
  ["Pink Heart", "🩷", "Love"],
  ["Couple", "💑", "Love"],
  ["Forever", "💖", "Love"],

  ["Crown", "👑", "Royal"],
  ["Castle", "🏰", "Royal"],
  ["Throne", "🪑", "Royal"],
  ["Royal Car", "🚗", "Royal"],
  ["Royal Horse", "🐎", "Royal"],
  ["Golden Crown", "👑", "Royal"],
  ["Royal Palace", "🏯", "Royal"],
  ["Royal Ring", "💍", "Royal"],
  ["Royal King", "🤴", "Royal"],
  ["Royal Queen", "👸", "Royal"],

  ["Diamond", "💎", "VIP"],
  ["Luxury Car", "🏎️", "VIP"],
  ["Airplane", "✈️", "VIP"],
  ["Yacht", "🛥️", "VIP"],
  ["Private Jet", "🛩️", "VIP"],
  ["Golden House", "🏡", "VIP"],
  ["Luxury Watch", "⌚", "VIP"],
  ["Golden Bag", "👜", "VIP"],
  ["VIP Star", "🌟", "VIP"],
  ["VIP Box", "🎁", "VIP"],

  ["Lucky Clover", "🍀", "Lucky"],
  ["Magic Lamp", "🪔", "Lucky"],
  ["Lucky Star", "⭐", "Lucky"],
  ["Rainbow", "🌈", "Lucky"],
  ["Four Leaf", "☘️", "Lucky"],
  ["Gold Coin", "🪙", "Lucky"],
  ["Treasure", "💰", "Lucky"],
  ["Magic Wand", "🪄", "Lucky"],
  ["Lucky Bell", "🔔", "Lucky"],
  ["Lucky Gift", "🎁", "Lucky"],

  ["Birthday Cake", "🎂", "Festival"],
  ["Fireworks", "🎆", "Festival"],
  ["Party Popper", "🎉", "Festival"],
  ["Christmas Tree", "🎄", "Festival"],
  ["Pumpkin", "🎃", "Festival"],
  ["Festival Lamp", "🏮", "Festival"],
  ["Music", "🎵", "Festival"],
  ["Dance", "💃", "Festival"],
  ["Celebration", "🥳", "Festival"],
  ["Universe", "🌌", "Special"]
];

const PRICE_LEVELS = [
  10, 20, 50, 100, 200,
  500, 1000, 2000, 5000, 10000
];

const GIFTS = [];

for (let i = 0; i < GIFT_NAMES.length; i++) {
  for (let j = 0; j < PRICE_LEVELS.length; j++) {
    const item = GIFT_NAMES[i];

    GIFTS.push({
      id: `gift_${i + 1}_${j + 1}`,
      name: `${item[0]} ${j + 1}`,
      icon: item[1],
      category: item[2],
      price: PRICE_LEVELS[j]
    });
  }
}

const ALLOWED_EMOJIS = [
  "😀", "😍", "🥰", "😂", "🤣", "😘",
  "❤️", "💕", "🔥", "👏", "🎉", "🌹",
  "👍", "🥳", "😎", "💖", "✨", "🤗"
];

/* =========================================
   FRAMES
========================================= */

const FRAMES = [
  {
    id: "frame_free",
    name: "Basic Frame",
    price: 0,
    free: true,
    icon: "🖼️"
  },
  {
    id: "frame_pink",
    name: "Pink Love",
    price: 500,
    free: false,
    icon: "💗"
  },
  {
    id: "frame_blue",
    name: "Blue Galaxy",
    price: 1000,
    free: false,
    icon: "🌌"
  },
  {
    id: "frame_gold",
    name: "Golden Royal",
    price: 2500,
    free: false,
    icon: "👑"
  },
  {
    id: "frame_diamond",
    name: "Diamond Frame",
    price: 5000,
    free: false,
    icon: "💎"
  },
  {
    id: "frame_rainbow",
    name: "Rainbow Frame",
    price: 7500,
    free: false,
    icon: "🌈"
  },
  {
    id: "frame_vip",
    name: "VIP Frame",
    price: 10000,
    free: false,
    icon: "⭐"
  }
];

/* =========================================
   ROOM TASKS
========================================= */

const ROOM_TASKS = [
  {
    id: "join_room",
    name: "Join a Room",
    description: "Join any voice room",
    reward: 100
  },
  {
    id: "send_message",
    name: "Send a Message",
    description: "Send a chat message",
    reward: 100
  },
  {
    id: "send_gift",
    name: "Send a Gift",
    description: "Send a gift to a user",
    reward: 200
  },
  {
    id: "take_seat",
    name: "Take a Seat",
    description: "Join a room seat",
    reward: 100
  },
  {
    id: "use_emoji",
    name: "Send an Emoji",
    description: "Send an emoji in a room",
    reward: 100
  }
];

const online = new Map();
const rooms = new Map();

/* =========================================
   HELPERS
========================================= */

function clean(value, max = 100) {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, max);
}

function getIndiaDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

const WELCOME_REWARD_COINS = 10000000;
const DAILY_REWARD_COINS = 1000000;

function reply(callback, data) {
  if (typeof callback === "function") {
    callback(data);
  }
}

function getUser(socket) {
  return online.get(socket.id) || null;
}

function getProfile(socket) {
  const user = getUser(socket);
  return user ? db.profiles[user.id] : null;
}

function getRoom(socket) {
  return rooms.get(socket.data.roomId) || null;
}

function isOwner(room, user) {
  return Boolean(room && user && room.ownerId === user.id);
}

function isAdmin(room, user) {
  return Boolean(
    room &&
    user &&
    (room.ownerId === user.id || room.admins.has(user.id))
  );
}

function isMember(room, socket) {
  return Boolean(room && room.members.has(socket.id));
}

function findGift(giftId) {
  return GIFTS.find(gift =>
    gift.id === String(giftId) ||
    gift.name.toLowerCase() === String(giftId).toLowerCase()
  );
}

function getMembers(room) {
  return [...room.members].map(socketId => {
    const user = online.get(socketId);
    if (!user) return null;

    const seatIndex = room.seats.findIndex(
      seat => seat && seat.socketId === socketId
    );

    return {
      id: user.id,
      userId: user.id,
      name: user.name,
      avatar: user.avatar || "",
      level: user.level || 1,
      frame: user.frame || "frame_free",
      socketId,
      seat: seatIndex === -1 ? null : seatIndex + 1,
      micOn: room.micStates.get(socketId) !== false,
      isOwner: room.ownerId === user.id,
      isAdmin: room.admins.has(user.id)
    };
  }).filter(Boolean);
}

function getRanking(room) {
  return [...room.giftRanking.values()]
    .sort((a, b) => b.coins - a.coins)
    .slice(0, 20);
}

function getRoomList() {
  return [...rooms.values()].map(room => ({
    id: room.id,
    name: room.name,
    owner: room.ownerName,
    ownerId: room.ownerId,
    members: room.members.size,
    seats: room.seatCount,
    locked: room.locked
  }));
}

function updateRooms() {
  io.emit("room-list", getRoomList());
}

function updateRoom(room) {
  if (!room) return;

  const members = getMembers(room);

  io.to(room.id).emit("members-update", {
    members,
    seats: room.seats,
    room
  });

  io.to(room.id).emit("room-update", {
    id: room.id,
    name: room.name,
    owner: room.ownerName,
    ownerName: room.ownerName,
    ownerId: room.ownerId,
    description: room.settings.description,
    seats: room.seats,
    settings: room.settings
  });

  io.to(room.id).emit("seats-update", room.seats);

  io.to(room.id).emit("room-settings-update", {
    name: room.name,
    description: room.settings.description,
    seats: room.seats.length,
    locked: room.settings.locked,
    allowYoutube: room.settings.allowYoutube
  });

  io.to(room.id).emit("gift-ranking", getRanking(room));

  for (const socketId of room.members) {
    const memberSocket = io.sockets.sockets.get(socketId);
    const member = online.get(socketId);

    if (memberSocket && member) {
      memberSocket.emit("admin-status", {
        isAdmin: isAdmin(room, member)
      });
    }
  }

  updateRooms();
}

function removeFromSeat(room, socketId) {
  room.seats = room.seats.map(seat =>
    seat && seat.socketId === socketId ? null : seat
  );
}

function completeTask(userId, taskId) {
  const profile = db.profiles[userId];
  const task = ROOM_TASKS.find(item => item.id === taskId);

  if (!profile || !task) return;

  profile.taskProgress ||= {};
  profile.claimedTasks ||= [];

  if (profile.claimedTasks.includes(taskId)) return;

  profile.taskProgress[taskId] = true;
}

function claimTask(userId, taskId) {
  const profile = db.profiles[userId];
  const task = ROOM_TASKS.find(item => item.id === taskId);

  if (!profile || !task) {
    return {
      ok: false,
      message: "Task not found"
    };
  }

  profile.taskProgress ||= {};
  profile.claimedTasks ||= [];

  if (!profile.taskProgress[taskId]) {
    return {
      ok: false,
      message: "Complete the task first"
    };
  }

  if (profile.claimedTasks.includes(taskId)) {
    return {
      ok: false,
      message: "Reward already claimed"
    };
  }

  profile.claimedTasks.push(taskId);
  profile.coins += task.reward;

  saveDB();

  return {
    ok: true,
    reward: task.reward,
    coins: profile.coins
  };
}

function leaveRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  const room = rooms.get(roomId);
  const user = getUser(socket);

  if (room) {
    room.members.delete(socket.id);
    room.micStates.delete(socket.id);

    removeFromSeat(room, socket.id);

    socket.to(roomId).emit("system-message", {
      message: `${user?.name || "User"} left the room.`
    });

    socket.to(roomId).emit("voice-peer-left", {
      socketId: socket.id
    });

    socket.leave(roomId);

    if (room.members.size === 0) {
      rooms.delete(roomId);
      updateRooms();
    } else {
      updateRoom(room);
    }
  }

  socket.data.roomId = null;
}

/* =========================================
   SOCKET CONNECTION
========================================= */

io.on("connection", socket => {
  socket.data.roomId = null;
  socket.data.userId = null;

  /* =======================================
     REGISTER
  ======================================= */

  socket.on("register", (data, callback) => {
    const name = clean(data?.name, 20) || "Huka User";

    const requestedId = clean(
      data?.userId || data?.profileId,
      20
    );

    let id = requestedId;
    let profile = db.profiles[id];
    let isNewUser = false;

    if (!profile) {
      id = String(db.nextUserId++);
      isNewUser = true;

      profile = {
        id,
        name,
        avatar: "",
        bio: "",
        country: "",
        gender: "",
        coins: WELCOME_REWARD_COINS,
        diamonds: 0,
        level: 1,
        totalGifts: 0,
        frame: "frame_free",
        ownedFrames: ["frame_free"],
        following: [],
        taskProgress: {},
        claimedTasks: [],
        dailyRewardDate: "",
        createdAt: Date.now()
      };

      db.profiles[id] = profile;
    } else {
      profile.name = name;
      profile.coins = Number(profile.coins) || 0;
      profile.diamonds = Number(profile.diamonds) || 0;
      profile.ownedFrames ||= ["frame_free"];
      profile.following ||= [];
      profile.taskProgress ||= {};
      profile.claimedTasks ||= [];
      profile.dailyRewardDate ||= "";
    }

    socket.data.userId = id;

    const user = {
      id,
      name: profile.name,
      avatar: profile.avatar || "",
      coins: Number(profile.coins) || 0,
      diamonds: Number(profile.diamonds) || 0,
      level: Number(profile.level) || 1,
      frame: profile.frame || "frame_free"
    };

    online.set(socket.id, user);
    saveDB();

    reply(callback, {
      ok: true,
      isNewUser,
      welcomeReward: isNewUser ? WELCOME_REWARD_COINS : 0,
      user
    });

    io.emit("online-count", online.size);
  });

  /* =======================================
     PROFILE
  ======================================= */

  socket.on("get-profile", (data, callback) => {
    const user = getUser(socket);

    if (!user) {
      return reply(callback, {
        ok: false,
        message: "Register first"
      });
    }

    const targetId = clean(data?.userId, 20);
    const profile = db.profiles[targetId || user.id];

    if (!profile) {
      return reply(callback, {
        ok: false,
        message: "Profile not found"
      });
    }

    const result = { ...profile };

    // Do not expose private information.
    delete result.taskProgress;

    reply(callback, {
      ok: true,
      profile: result
    });
  });

  socket.on("profile-update", (data, callback) => {
    const user = getUser(socket);

    if (!user) {
      return reply(callback, { ok: false });
    }

    const profile = db.profiles[user.id];

    if (data.name !== undefined) {
      profile.name = clean(data.name, 20) || profile.name;
      user.name = profile.name;
    }

    if (data.avatar !== undefined) {
      profile.avatar = clean(data.avatar, 500000);
      user.avatar = profile.avatar;
    }

    if (data.bio !== undefined) {
      profile.bio = clean(data.bio, 250);
    }

    if (data.country !== undefined) {
      profile.country = clean(data.country, 60);
    }

    if (data.gender !== undefined) {
      const gender = clean(data.gender, 20);

      if (!["Male", "Female", "Other", "Prefer not to say", ""].includes(gender)) {
        return reply(callback, {
          ok: false,
          message: "Invalid gender selection"
        });
      }

      profile.gender = gender;
    }

    saveDB();

    reply(callback, {
      ok: true,
      profile
    });

    socket.emit("profile-update", profile);
  });

  /* =======================================
     FOLLOW
  ======================================= */

  socket.on("follow-user", (data, callback) => {
    const user = getUser(socket);
    const targetId = clean(data?.userId, 20);

    if (!user || !db.profiles[targetId] || targetId === user.id) {
      return reply(callback, {
        ok: false,
        message: "Invalid user"
      });
    }

    const profile = db.profiles[user.id];
    profile.following ||= [];

    if (profile.following.includes(targetId)) {
      profile.following = profile.following.filter(id => id !== targetId);

      saveDB();

      return reply(callback, {
        ok: true,
        following: false
      });
    }

    profile.following.push(targetId);

    saveDB();

    reply(callback, {
      ok: true,
      following: true
    });
  });

  /* =======================================
     FRAMES / BAG
  ======================================= */

  socket.on("get-frames", callback => {
    const user = getUser(socket);
    const profile = getProfile(socket);

    if (!user || !profile) {
      return reply(callback, {
        ok: false,
        message: "Register first"
      });
    }

    reply(callback, {
      ok: true,
      frames: FRAMES,
      ownedFrames: profile.ownedFrames || ["frame_free"],
      activeFrame: profile.frame || "frame_free",
      coins: profile.coins
    });
  });

  socket.on("buy-frame", (data, callback) => {
    const user = getUser(socket);
    const profile = getProfile(socket);

    if (!user || !profile) {
      return reply(callback, { ok: false });
    }

    const frame = FRAMES.find(item => item.id === data?.frameId);

    if (!frame) {
             return reply(callback, {
        ok: false,
        message: "Frame not found"
      });
    }

    profile.ownedFrames ||= ["frame_free"];

    if (profile.ownedFrames.includes(frame.id)) {
      return reply(callback, {
        ok: false,
        message: "Frame already owned"
      });
    }

    if (profile.coins < frame.price) {
      return reply(callback, {
        ok: false,
        message: "Not enough coins"
      });
    }

    profile.coins -= frame.price;
    profile.ownedFrames.push(frame.id);

    user.coins = profile.coins;

    saveDB();

    reply(callback, {
      ok: true,
      coins: profile.coins,
      ownedFrames: profile.ownedFrames
    });
  });

  socket.on("equip-frame", (data, callback) => {
    const user = getUser(socket);
    const profile = getProfile(socket);

    if (!user || !profile) {
      return reply(callback, { ok: false });
    }

    const frameId = clean(data?.frameId, 50);

    profile.ownedFrames ||= ["frame_free"];

    if (!profile.ownedFrames.includes(frameId)) {
      return reply(callback, {
        ok: false,
        message: "You do not own this frame"
      });
    }

    profile.frame = frameId;
    user.frame = frameId;

    saveDB();

    reply(callback, {
      ok: true,
      frame: frameId
    });
  });

  /* =======================================
     ROOM TASKS
  ======================================= */

  socket.on("get-room-tasks", callback => {
    const user = getUser(socket);
    const profile = getProfile(socket);

    if (!user || !profile) {
      return reply(callback, { ok: false });
    }

    const tasks = ROOM_TASKS.map(task => ({
      ...task,
      completed: Boolean(profile.taskProgress?.[task.id]),
      claimed: Boolean(profile.claimedTasks?.includes(task.id))
    }));

    reply(callback, {
      ok: true,
      tasks,
      coins: profile.coins,
      totalRewards: ROOM_TASKS.reduce(
        (sum, task) => sum + task.reward,
        0
      )
    });
  });

  socket.on("claim-room-task", (data, callback) => {
    const user = getUser(socket);

    if (!user) {
      return reply(callback, { ok: false });
    }

    const result = claimTask(
      user.id,
      clean(data?.taskId, 50)
    );

    if (result.ok) {
      user.coins = result.coins;

      socket.emit("profile-update", {
        id: user.id,
        coins: result.coins
      });
    }

    reply(callback, result);
  });

  /* =======================================
     DAILY LOGIN REWARD
     10 lakh virtual coins, once per India day
  ======================================= */

  socket.on("get-daily-tasks", callback => {
    const user = getUser(socket);
    const profile = getProfile(socket);

    if (!user || !profile) {
      return reply(callback, {
        ok: false,
        message: "Register first"
      });
    }

    const today = getIndiaDate();
    const claimed = profile.dailyRewardDate === today;

    reply(callback, {
      ok: true,
      tasks: [
        {
          id: "daily_login",
          name: "Daily Login Reward",
          description: "Claim your daily login reward",
          reward: DAILY_REWARD_COINS,
          completed: claimed,
          claimed
        }
      ],
      coins: Number(profile.coins) || 0,
      canClaim: !claimed,
      reward: DAILY_REWARD_COINS,
      date: today,
      nextReset: "12:00 AM India Time"
    });
  });

  socket.on("claim-daily-task", (data, callback) => {
    const user = getUser(socket);
    const profile = getProfile(socket);

    if (!user || !profile) {
      return reply(callback, {
        ok: false,
        message: "Register first"
      });
    }

    const today = getIndiaDate();

    if (profile.dailyRewardDate === today) {
      return reply(callback, {
        ok: false,
        message: "Today's reward has already been claimed",
        coins: Number(profile.coins) || 0,
        claimed: true
      });
    }

    profile.coins = (Number(profile.coins) || 0) +
      DAILY_REWARD_COINS;
    profile.dailyRewardDate = today;
    user.coins = profile.coins;

    saveDB();

    const result = {
      ok: true,
      reward: DAILY_REWARD_COINS,
      coins: profile.coins,
      claimed: true,
      date: today
    };

    socket.emit("profile-update", {
      id: user.id,
      coins: profile.coins
    });

    reply(callback, result);
  });

  /* =======================================
     ROOM LIST
  ======================================= */

  socket.on("get-rooms", (data, callback) => {
    const roomList = getRoomList();
    socket.emit("room-list", roomList);
    reply(callback, {
      ok: true,
      rooms: roomList
    });
  });

  socket.on("room-list", (data, callback) => {
    const roomList = getRoomList();
    socket.emit("room-list", roomList);
    reply(callback, {
      ok: true,
      rooms: roomList
    });
  });

  /* =======================================
     CREATE ROOM
  ======================================= */

  socket.on("create-room", (data, callback) => {
    const user = getUser(socket);

    if (!user) {
      return reply(callback, {
        ok: false,
        message: "Register first"
      });
    }

    if (socket.data.roomId) {
      leaveRoom(socket);
    }

    const id = String(db.nextRoomId++);

    const requestedSeats = Number(data?.seats);
    const seatCount = ALLOWED_SEATS.includes(requestedSeats)
      ? requestedSeats
      : 9;

    const room = {
      id,
      name: clean(data?.name, 35) || `${user.name}'s Room`,
      ownerId: user.id,
      ownerName: user.name,

      admins: new Set(),
      members: new Set(),

      seats: Array(seatCount).fill(null),
      micStates: new Map(),

      messages: [],
      giftRanking: new Map(),

      settings: {
        locked: false,
        allowYoutube: true,
        description: clean(data?.description, 150)
      },

      createdAt: Date.now()
    };

    rooms.set(id, room);

    reply(callback, {
      ok: true,
      id,
      seats: seatCount
    });

    updateRooms();
  });

  /* =======================================
     JOIN ROOM
  ======================================= */

  socket.on("join-room", (data, callback) => {
    const user = getUser(socket);
    const roomId = clean(data?.roomId, 20);
    const room = rooms.get(roomId);

    if (!user) {
      return reply(callback, {
        ok: false,
        message: "Register first"
      });
    }

    if (!room) {
      return reply(callback, {
        ok: false,
        message: "Room not found"
      });
    }

    if (room.settings.locked && !isAdmin(room, user)) {
      return reply(callback, {
        ok: false,
        message: "This room is locked"
      });
    }

    if (socket.data.roomId) {
      leaveRoom(socket);
    }

    socket.join(roomId);
    socket.data.roomId = roomId;

    room.members.add(socket.id);
    room.micStates.set(socket.id, true);

    completeTask(user.id, "join_room");

    reply(callback, {
      ok: true,
      room: {
        id: room.id,
        name: room.name,
        owner: room.ownerName,
        ownerName: room.ownerName,
        ownerId: room.ownerId
      },
      messages: room.messages,
      seats: room.seats,
      settings: room.settings,
      members: getMembers(room)
    });

    socket.to(roomId).emit("system-message", {
      message: `${user.name} joined the room.`
    });

    socket.emit("voice-existing-peers",
      [...room.members].filter(id => id !== socket.id)
    );

    socket.to(roomId).emit("voice-peer-joined", {
      socketId: socket.id
    });

    updateRoom(room);
    saveDB();
  });

  socket.on("leave-room", (data, callback) => {
    leaveRoom(socket);
    reply(callback, { ok: true });
  });

  /* =======================================
     SEATS
  ======================================= */

  socket.on("take-seat", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);

    if (!room || !user || !isMember(room, socket)) {
      return reply(callback, {
        ok: false,
        message: "Join a room first"
      });
    }

    const seatNumber = typeof data === "object"
      ? Number(data.seat)
      : Number(data);

    const index = seatNumber - 1;

    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= room.seats.length
    ) {
      return reply(callback, {
        ok: false,
        message: "Invalid seat"
      });
    }

    if (room.seats[index]) {
      return reply(callback, {
        ok: false,
        message: "Seat is occupied"
      });
    }

    removeFromSeat(room, socket.id);

    room.seats[index] = {
      socketId: socket.id,
      userId: user.id,
      name: user.name,
      avatar: user.avatar || ""
    };

    completeTask(user.id, "take_seat");

    updateRoom(room);

    reply(callback, {
      ok: true,
      seat: seatNumber
    });
  });

  socket.on("leave-seat", (data, callback) => {
    const room = getRoom(socket);

    if (!room) {
      return reply(callback, { ok: false });
    }

    removeFromSeat(room, socket.id);
    updateRoom(room);

    reply(callback, { ok: true });
  });

  /* =======================================
     MIC CONTROL
  ======================================= */

  socket.on("toggle-mic", (data, callback) => {
    const room = getRoom(socket);

    if (!room || !isMember(room, socket)) {
      return reply(callback, { ok: false });
    }

    const current = room.micStates.get(socket.id) !== false;
    const micOn = data?.micOn === undefined
      ? !current
      : Boolean(data.micOn);

    room.micStates.set(socket.id, micOn);

    io.to(room.id).emit("mic-update", {
      socketId: socket.id,
      micOn
    });

    updateRoom(room);

    reply(callback, {
      ok: true,
      micOn
    });
  });
