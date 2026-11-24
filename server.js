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
  inbox: {},
  families: {},
  cpRequests: {},
  cdKeys: { HUKA100: { reward: 100000, usedBy: [] } }
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
      inbox: saved.inbox || {},
      families: saved.families || {},
      cpRequests: saved.cpRequests || {},
      cdKeys: saved.cdKeys || { HUKA100: { reward: 100000, usedBy: [] } }
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
   FRAMES - 50 DESIGNS
========================================= */

const BASIC_FRAMES = [
  {
    id: "frame_free",
    name: "Basic Frame",
    price: 0,
    free: true,
    icon: "🖼️",
    gradient: "linear-gradient(135deg,#d1d5db,#6b7280)"
  },
  {
    id: "frame_pink",
    name: "Pink Love",
    price: 500,
    free: false,
    icon: "💗",
    gradient: "linear-gradient(135deg,#ff4fa3,#ffb6d9)"
  },
  {
    id: "frame_blue",
    name: "Blue Galaxy",
    price: 1000,
    free: false,
    icon: "🌌",
    gradient: "linear-gradient(135deg,#2563eb,#a855f7)"
  },
  {
    id: "frame_gold",
    name: "Golden Royal",
    price: 2500,
    free: false,
    icon: "👑",
    gradient: "linear-gradient(135deg,#facc15,#b45309)"
  },
  {
    id: "frame_diamond",
    name: "Diamond Frame",
    price: 5000,
    free: false,
    icon: "💎",
    gradient: "linear-gradient(135deg,#67e8f9,#2563eb)"
  },
  {
    id: "frame_rainbow",
    name: "Rainbow Frame",
    price: 7500,
    free: false,
    icon: "🌈",
    gradient: "linear-gradient(135deg,#ff0000,#ff9900,#ffff00,#00cc66,#3399ff,#9933ff)"
  },
  {
    id: "frame_vip",
    name: "VIP Frame",
    price: 10000,
    free: false,
    icon: "⭐",
    gradient: "linear-gradient(135deg,#9333ea,#facc15,#ec4899)"
  },
  {
    id: "frame_svip",
    name: "SVIP Diamond Frame",
    price: 50000,
    free: false,
    tier: "SVIP",
    icon: "💎",
    gradient: "linear-gradient(135deg,#00e5ff,#a855f7,#ff4fd8,#fff1a8)"
  }
];

const EXTRA_FRAME_NAMES = [
  "Royal Purple", "Ocean Wave", "Red Fire", "Emerald Green",
  "Silver Shine", "Sunset Glow", "Moon Light", "Crystal Blue",
  "Rose Gold", "Dark Galaxy", "Neon Pink", "Neon Green",
  "Ice Queen", "Golden Star", "Magic Purple", "Aqua Dream",
  "Ruby Red", "Sapphire", "Jade Royal", "Lavender Love",
  "Electric Blue", "Orange Flame", "Mystic Night", "Pearl White",
  "Cyber Neon", "Butterfly", "Flower Garden", "Aurora",
  "Diamond Rose", "Royal Crown", "Star Light", "Galaxy Ring",
  "Rainbow Pearl", "Pink Princess", "Blue Angel", "Golden Dragon",
  "Cosmic Heart", "Emerald Crown", "Luxury Shine", "Magic Rainbow",
  "Huka Special", "Huka Legend", "Huka Premium"
];

const FRAME_ICONS = [
  "💜", "🌊", "🔥", "💚", "🥈",
  "🌅", "🌙", "🧊", "🌹", "🌌",
  "💖", "🍀", "❄️", "⭐", "🔮",
  "🩵", "♦️", "💠", "🍃", "💐",
  "⚡", "🧡", "🌃", "🤍", "💫",
  "🦋", "🌸", "🌈", "💎", "👑",
  "✨", "🌠", "🦄", "👸", "👼",
  "🐉", "💗", "💚", "💰", "🌈",
  "❤️", "🏆", "💎"
];

const EXTRA_FRAMES = EXTRA_FRAME_NAMES.map((name, index) => {
  const hue = (index * 29 + 15) % 360;
  const hue2 = (hue + 75) % 360;
  const hue3 = (hue + 155) % 360;

  return {
    id: `frame_${String(index + 8).padStart(2, "0")}`,
    name,
    price: (index + 1) * 500 + 500,
    free: false,
    icon: FRAME_ICONS[index],
    gradient: `linear-gradient(135deg,hsl(${hue},90%,60%),hsl(${hue2},90%,55%),hsl(${hue3},85%,60%))`
  };
});

const FRAMES = [...BASIC_FRAMES, ...EXTRA_FRAMES];

function getFrameDesign(frameId) {
  return FRAMES.find(frame => frame.id === frameId) || FRAMES[0];
     }

/* =========================================
   HUKA COMPLETE BAG ITEM STORE
========================================= */

const VEHICLE_LIST = [
  ["Royal Car", "🚗"],
  ["Sports Car", "🏎️"],
  ["Luxury Car", "🚘"],
  ["Super Car", "🏎️"],
  ["Golden Car", "🚕"],
  ["Pink Car", "🚗"],
  ["Blue Racing Car", "🏎️"],
  ["Neon Car", "🚙"],
  ["Royal Jeep", "🚙"],
  ["Monster Truck", "🛻"],
  ["Royal Bike", "🏍️"],
  ["Sports Bike", "🏍️"],
  ["Golden Bike", "🏍️"],
  ["Red Bike", "🏍️"],
  ["Blue Bike", "🏍️"],
  ["Super Bike", "🏍️"],
  ["Royal Scooter", "🛵"],
  ["Luxury Scooter", "🛵"],
  ["Golden Horse", "🐎"],
  ["White Horse", "🐎"],
  ["Black Horse", "🐎"],
  ["Royal Horse", "🐎"],
  ["Pegasus", "🪽"],
  ["Unicorn Ride", "🦄"],
  ["Royal Bicycle", "🚲"],
  ["Mountain Bike", "🚵"],
  ["Golden Yacht", "🛥️"],
  ["Luxury Yacht", "🛥️"],
  ["Royal Ship", "🚢"],
  ["Speed Boat", "🚤"],
  ["Private Jet", "🛩️"],
  ["Royal Airplane", "✈️"],
  ["Golden Plane", "✈️"],
  ["Helicopter", "🚁"],
  ["Royal Helicopter", "🚁"],
  ["Space Rocket", "🚀"],
  ["Galaxy Rocket", "🚀"],
  ["Royal Train", "🚆"],
  ["Bullet Train", "🚄"],
  ["Luxury Bus", "🚌"],
  ["Royal Bus", "🚌"],
  ["Golden Truck", "🚚"],
  ["Luxury Van", "🚐"],
  ["Royal Carriage", "🐴"],
  ["Magic Carpet", "🪄"],
  ["Dragon Ride", "🐉"],
  ["Phoenix Ride", "🔥"],
  ["Galaxy Vehicle", "🌌"],
  ["Diamond Vehicle", "💎"],
  ["Huka Royal Vehicle", "👑"]
];

const BAG_DESIGNS = {
  chatBubble: [
    ["Pink Love Bubble", "💗"],
    ["Blue Galaxy Bubble", "🌌"],
    ["Golden Royal Bubble", "👑"],
    ["Diamond Bubble", "💎"],
    ["Rainbow Bubble", "🌈"],
    ["Neon Bubble", "💫"],
    ["Heart Bubble", "❤️"],
    ["Fire Bubble", "🔥"],
    ["Star Bubble", "⭐"],
    ["Royal Purple Bubble", "💜"],
    ["Ocean Bubble", "🌊"],
    ["Crystal Bubble", "🧊"]
  ],

  profileCard: [
    ["Pink Princess Card", "👸"],
    ["Royal King Card", "🤴"],
    ["Golden VIP Card", "👑"],
    ["Diamond Card", "💎"],
    ["Galaxy Card", "🌌"],
    ["Love Card", "💗"],
    ["Rainbow Card", "🌈"],
    ["Neon Card", "✨"],
    ["Butterfly Card", "🦋"],
    ["Royal Empire Card", "🏰"]
  ],

  rgbName: [
    ["Rainbow RGB", "🌈"],
    ["Neon Pink", "💗"],
    ["Neon Blue", "💙"],
    ["Neon Purple", "💜"],
    ["Golden Glow", "✨"],
    ["Fire RGB", "🔥"],
    ["Diamond RGB", "💎"],
    ["Galaxy RGB", "🌌"]
  ],

  entryEffect: [
    ["Rose Entry", "🌹"],
    ["Heart Entry", "💗"],
    ["Golden Entry", "👑"],
    ["Diamond Entry", "💎"],
    ["Fire Entry", "🔥"],
    ["Rainbow Entry", "🌈"],
    ["Butterfly Entry", "🦋"],
    ["Star Entry", "⭐"],
    ["Galaxy Entry", "🌌"],
    ["Royal Entry", "🏰"]
  ],

  micEffect: [
    ["Pink Mic", "🎤"],
    ["Golden Mic", "🎙️"],
    ["Diamond Mic", "💎"],
    ["Rainbow Mic", "🌈"],
    ["Fire Mic", "🔥"],
    ["Galaxy Mic", "🌌"],
    ["Neon Mic", "✨"],
    ["Royal Mic", "👑"]
  ],

  nameDecoration: [
    ["Royal Crown", "👑"],
    ["Golden Star", "⭐"],
    ["Pink Heart", "💗"],
    ["Diamond Decoration", "💎"],
    ["Butterfly Decoration", "🦋"],
    ["Angel Wings", "🪽"],
    ["Fire Decoration", "🔥"],
    ["Rainbow Decoration", "🌈"],
    ["Royal Rose", "🌹"],
    ["Galaxy Decoration", "🌌"]
  ],

  specialEffect: [
    ["Royal Aura", "👑"],
    ["Diamond Aura", "💎"],
    ["Rainbow Aura", "🌈"],
    ["Galaxy Aura", "🌌"],
    ["Fire Aura", "🔥"],
    ["Angel Aura", "😇"],
    ["Butterfly Aura", "🦋"],
    ["Legendary Aura", "✨"]
  ]
};

const BAG_ITEMS = [];

// Existing frames also appear in Bag.
for (const frame of FRAMES) {
  BAG_ITEMS.push({
    id: frame.id,
    name: frame.name,
    category: "frame",
    icon: frame.icon,
    price: frame.price,
    free: Boolean(frame.free),
    design: frame.gradient
  });
}

// Generate exactly 50 vehicles.
VEHICLE_LIST.forEach((vehicle, index) => {
  BAG_ITEMS.push({
    id: `vehicle_${index + 1}`,
    name: vehicle[0],
    category: "vehicle",
    icon: vehicle[1],
    price: (index + 1) * 1000,
    free: false
  });
});

// Generate all other Bag categories.
for (const [category, designs] of Object.entries(BAG_DESIGNS)) {
  designs.forEach((item, index) => {
    BAG_ITEMS.push({
      id: `${category}_${index + 1}`,
      name: item[0],
      category,
      icon: item[1],
      price: (index + 1) * 500,
      free: false
    });
  });
}

const BAG_CATEGORIES = [
  "all",
  "frame",
  "vehicle",
  "chatBubble",
  "profileCard",
  "rgbName",
  "entryEffect",
  "micEffect",
  "nameDecoration",
  "specialEffect"
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

// CP PARTNER VOICE TIME TRACKER
const cpVoiceSessions = new Map();

const CP_VOICE_TASK = {
  duration: 10 * 60 * 1000,
  coins: 15000,
  xp: 3000
};

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

/* =========================================
   HUKA FAMILY SYSTEM - HELPER FUNCTIONS
========================================= */

function getFamilyMemberInfo(memberId, family) {
  const profile = db.profiles[String(memberId)] || {};

  return {
    id: memberId,
    name: profile.username || profile.name || "Huka User",
    avatar: profile.avatar || profile.dp || "",
    role: String(memberId) === String(family.ownerId)
      ? "Owner"
      : (family.admins || []).some(id => String(id) === String(memberId))
        ? "Admin"
        : "Member"
  };
}

function getFamilyData(family) {
  if (!family) return null;

  family.members ||= [];
  family.admins ||= [];
  family.chat ||= [];

  return {
    id: family.id,
    name: family.name,
    code: family.code,
    ownerId: family.ownerId,
    members: family.members.map(id =>
      getFamilyMemberInfo(id, family)
    ),
    memberCount: family.members.length,
    admins: family.admins,
    createdAt: family.createdAt
  };
}

function familyBroadcast(family) {
  if (!family) return;

  io.to("family_" + family.id).emit(
    "family:updated",
    getFamilyData(family)
  );
}

function addWalletHistory(profile, type, amount, note) {
  profile.walletHistory ||= [];
  profile.walletHistory.unshift({
    id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: clean(type, 30),
    amount: Number(amount) || 0,
    note: clean(note, 100),
    date: Date.now()
  });
  profile.walletHistory = profile.walletHistory.slice(0, 100);
}

function updateLevel(profile) {
  const earned = Math.max(0, Number(profile.totalExperience) || 0);
  profile.level = Math.max(1, Math.floor(Math.sqrt(earned / 100)) + 1);
  return profile.level;
     }

/* =========================================
   LEVEL XP PROGRESS SYSTEM
========================================= */

function getLevelProgress(profile) {
  const totalXP = Math.max(
    0,
    Number(profile.totalExperience) || 0
  );

  const level = updateLevel(profile);

  const currentLevelXP = (level - 1) ** 2 * 100;
  const nextLevelXP = level ** 2 * 100;

  return {
    level,
    currentXP: totalXP - currentLevelXP,
    requiredXP: nextLevelXP - currentLevelXP,
    totalXP
  };
}

/* =========================================
   HUKA LEVEL 1-100 REWARD SYSTEM
========================================= */

const LEVEL_SPECIAL_REWARDS = [
  "Bronze Crown",
  "Silver Crown",
  "Golden Crown",
  "Pink Heart Frame",
  "Purple Galaxy Frame",
  "Royal Butterfly Frame",
  "Diamond Avatar",
  "Golden Wings",
  "Level 10 Royal Medal",
  "Rainbow Name Effect",
  "Fire Avatar Effect",
  "Ice Avatar Effect",
  "Star Profile Frame",
  "Royal Rose Gift",
  "Golden Butterfly Effect",
  "Diamond Name Decoration",
  "Moonlight Frame",
  "Phoenix Medal",
  "Level 20 Royal Wings",
  "Neon Avatar Effect",
  "Crystal Frame",
  "Golden Star Gift",
  "Rainbow Wings",
  "Level 25 Diamond Crown",
  "Galaxy Name Effect",
  "Royal Tiger Frame",
  "Shooting Star Effect",
  "Emerald Medal",
  "Level 30 Dragon Frame",
  "Golden Phoenix Effect",
  "Crystal Butterfly Gift",
  "Ocean Avatar Frame",
  "Diamond Heart Medal",
  "Royal Unicorn Frame",
  "Lightning Name Effect",
  "Golden Eagle Wings",
  "Aurora Avatar Effect",
  "Ruby Medal",
  "Level 40 Imperial Crown",
  "Cosmic Profile Frame",
  "Golden Lion Effect",
  "Diamond Rose Gift",
  "Royal Moon Frame",
  "Sapphire Medal",
  "Rainbow Dragon Effect",
  "Golden Phoenix Frame",
  "Starlight Avatar Effect",
  "Royal Heart Medal",
  "Level 50 Legendary Crown",
  "Galaxy Dragon Wings",
  "Diamond Butterfly Frame",
  "Royal Fire Gift",
  "Golden Universe Effect",
  "Level 55 Emperor Medal",
  "Crystal Dragon Frame",
  "Rainbow Phoenix Wings",
  "Royal Diamond Gift",
  "Eternal Star Medal",
  "Level 60 Emperor Crown",
  "Golden Galaxy Frame",
  "Cosmic Butterfly Effect",
  "Royal Universe Gift",
  "Diamond Tiger Wings",
  "Level 65 Mythical Medal",
  "Eternal Phoenix Frame",
  "Golden Angel Effect",
  "Royal Crystal Gift",
  "Galaxy Lion Medal",
  "Level 70 Legendary Wings",
  "Diamond Universe Frame",
  "Royal Aurora Effect",
  "Golden Dragon Gift",
  "Eternal Butterfly Medal",
  "Level 75 Royal Emperor Frame",
  "Cosmic Angel Wings",
  "Diamond Phoenix Effect",
  "Royal Galaxy Gift",
  "Golden Universe Medal",
  "Level 80 Mythical Crown",
  "Eternal Dragon Frame",
  "Diamond Angel Effect",
  "Royal Cosmic Gift",
  "Golden Phoenix Medal",
  "Level 85 Supreme Wings",
  "Eternal Galaxy Frame",
  "Diamond Universe Effect",
  "Royal Star Gift",
  "Mythical Dragon Medal",
  "Level 90 Supreme Crown",
  "Eternal Angel Frame",
  "Royal Phoenix Effect",
  "Diamond Galaxy Gift",
  "Supreme Universe Medal",
  "Level 95 Immortal Wings",
  "Eternal Royal Frame",
  "Supreme Dragon Effect",
  "Legendary Galaxy Gift",
  "Immortal Diamond Medal",
  "Ultimate Royal Crown + Immortal Frame + Legendary Aura"
];

/* =========================================
   ADD XP AND LEVEL REWARDS
========================================= */

function addExperience(profile, amount) {
  const today = getIndiaDate();

  if (profile.xpDailyDate !== today) {
    profile.xpDailyDate = today;
    profile.xpEarnedToday = 0;
  }

  const earnedToday = Number(profile.xpEarnedToday) || 0;
  const remaining = Math.max(0, 100 - earnedToday);

  const reward = Math.min(
    Math.max(0, Number(amount) || 0),
    remaining
  );

  if (reward <= 0) return 0;

  const oldLevel = updateLevel(profile);

  profile.totalExperience =
    (Number(profile.totalExperience) || 0) + reward;

  profile.xpEarnedToday = earnedToday + reward;

  const newLevel = updateLevel(profile);

  profile.claimedLevelRewards =
    Array.isArray(profile.claimedLevelRewards)
      ? profile.claimedLevelRewards
      : [];

  profile.levelRewardItems =
    Array.isArray(profile.levelRewardItems)
      ? profile.levelRewardItems
      : [];

  // Give separate rewards for every new level
  for (
    let level = oldLevel + 1;
    level <= Math.min(newLevel, 100);
    level++
  ) {
    if (profile.claimedLevelRewards.includes(level)) {
      continue;
    }

    // Level 2 = 100000 coins
    // Every next level adds 50000 coins
    const coinsReward = level * 50000;

    profile.coins =
      (Number(profile.coins) || 0) + coinsReward;

    const specialReward =
      LEVEL_SPECIAL_REWARDS[level - 2];

    profile.claimedLevelRewards.push(level);

    profile.levelRewardItems.push({
      level: level,
      name: specialReward,
      claimed: true,
      date: new Date().toISOString()
    });

    addWalletHistory(
      profile,
      "reward",
      coinsReward,
      `Level ${level} Up Reward`
    );
  }

  return reward;
}

/* =========================================
   CP SPACE + ANNIVERSARY + MEMORIES
========================================= */

function ensureCPProfile(profile) {
  profile.cpPartnerId ||= "";

  profile.cpXP = Number(profile.cpXP) || 0;
  profile.cpWeeklyXP = Number(profile.cpWeeklyXP) || 0;
  profile.cpMonthlyXP = Number(profile.cpMonthlyXP) || 0;
  profile.cpDailyXP = Number(profile.cpDailyXP) || 0;

  // CP Anniversary Data
  profile.cpPairedAt = Number(profile.cpPairedAt) || 0;
  profile.cpAnniversaryNotifiedYear =
    Number(profile.cpAnniversaryNotifiedYear) || 0;

  // CP Memories
  if (!Array.isArray(profile.cpMemories)) {
    profile.cpMemories = [];
  }

  const today = getIndiaDate();

  if (profile.cpDailyDate !== today) {
    profile.cpDailyDate = today;
    profile.cpDailyXP = 0;
  }

  const date = new Date(today + "T00:00:00Z");
  const day = (date.getUTCDay() + 6) % 7;

  date.setUTCDate(date.getUTCDate() - day);

  const weekKey = date.toISOString().slice(0, 10);
  const monthKey = today.slice(0, 7);

  if (profile.cpWeekKey !== weekKey) {
    profile.cpWeekKey = weekKey;
    profile.cpWeeklyXP = 0;
  }

  if (profile.cpMonthKey !== monthKey) {
    profile.cpMonthKey = monthKey;
    profile.cpMonthlyXP = 0;
  }
}

function getCPLevel(xp) {
  return Math.max(
    1,
    Math.floor(Math.sqrt(Math.max(0, Number(xp) || 0) / 100)) + 1
  );
}

function getCPProgress(profile) {
  ensureCPProfile(profile);

  const xp = profile.cpXP;
  const level = getCPLevel(xp);

  const currentXP = (level - 1) ** 2 * 100;
  const nextXP = level ** 2 * 100;

  return {
    level,
    totalXP: xp,
    currentXP: xp - currentXP,
    requiredXP: nextXP - currentXP
  };
}

/* =========================================
   CP PARTNER VOICE TIME SYSTEM
========================================= */

function findUserSocketInRoom(room, userId) {
  return [...room.members].find(socketId => {
    return online.get(socketId)?.id === userId;
  }) || null;
}

function startCPVoiceSession(room, user) {
  if (!room || !user) return;

  const profile = db.profiles[user.id];
  if (!profile?.cpPartnerId) return;

  const partnerId = profile.cpPartnerId;
  const partner = db.profiles[partnerId];

  if (!partner || partner.cpPartnerId !== user.id) return;

  const userSocket = findUserSocketInRoom(room, user.id);
  const partnerSocket = findUserSocketInRoom(room, partnerId);

  if (!userSocket || !partnerSocket) return;

  const sortedIds = [user.id, partnerId].sort();
  const sessionKey =
    `${room.id}:${sortedIds[0]}:${sortedIds[1]}`;

  if (cpVoiceSessions.has(sessionKey)) return;

  const session = {
    roomId: room.id,
    userIds: sortedIds,
    startedAt: Date.now(),
    timer: null
  };

  session.timer = setTimeout(() => {
    const currentRoom = rooms.get(session.roomId);

    if (!currentRoom) {
      cpVoiceSessions.delete(sessionKey);
      return;
    }

    const currentA = db.profiles[session.userIds[0]];
    const currentB = db.profiles[session.userIds[1]];

    const stillTogether =
      currentA &&
      currentB &&
      currentA.cpPartnerId === currentB.id &&
      currentB.cpPartnerId === currentA.id &&
      findUserSocketInRoom(currentRoom, currentA.id) &&
      findUserSocketInRoom(currentRoom, currentB.id);

    if (!stillTogether) {
      cpVoiceSessions.delete(sessionKey);
      return;
    }

    const result = completeCPDailyTask(
      currentA,
      currentB,
      "voice_10_minutes",
      CP_VOICE_TASK.coins,
      CP_VOICE_TASK.xp
    );

    if (result.ok) {
      for (const [socketId, onlineUser] of online.entries()) {
        if (
          onlineUser.id === currentA.id ||
          onlineUser.id === currentB.id
        ) {
          const currentProfile = db.profiles[onlineUser.id];

          if (currentProfile) {
            onlineUser.coins =
              Number(currentProfile.coins) || 0;

            io.to(socketId).emit("profile-update", {
              id: onlineUser.id,
              coins: currentProfile.coins,
              diamonds: currentProfile.diamonds
            });
          }
        }
      }
    }

    cpVoiceSessions.delete(sessionKey);

  }, CP_VOICE_TASK.duration);

  cpVoiceSessions.set(sessionKey, session);
}

function stopCPVoiceSession(roomId, userId) {
  for (const [key, session] of cpVoiceSessions.entries()) {
    if (
      session.roomId === roomId &&
      session.userIds.includes(userId)
    ) {
      clearTimeout(session.timer);
      cpVoiceSessions.delete(key);
    }
  }
     }

function addCPExperience(profileA, profileB, amount) {
  ensureCPProfile(profileA);
  ensureCPProfile(profileB);

  if (
    profileA.cpPartnerId !== profileB.id ||
    profileB.cpPartnerId !== profileA.id
  ) {
    return 0;
  }

  const earnedToday = Math.min(
    profileA.cpDailyXP,
    profileB.cpDailyXP
  );

  const remaining = Math.max(0, 100 - earnedToday);

  const reward = Math.min(
    Math.max(0, Number(amount) || 0),
    remaining
  );

  if (reward <= 0) return 0;

  for (const profile of [profileA, profileB]) {
    profile.cpXP += reward;
    profile.cpWeeklyXP += reward;
    profile.cpMonthlyXP += reward;
    profile.cpDailyXP = earnedToday + reward;
  }

  return reward;
}

/* =========================================
   CP TASK XP REWARDS
========================================= */

function addCPTaskExperience(profileA, profileB, amount) {
  ensureCPProfile(profileA);
  ensureCPProfile(profileB);

  if (
    profileA.cpPartnerId !== profileB.id ||
    profileB.cpPartnerId !== profileA.id
  ) {
    return 0;
  }

  const reward = Math.max(
    0,
    Math.floor(Number(amount) || 0)
  );

  if (reward <= 0) return 0;

  for (const profile of [profileA, profileB]) {
    profile.cpXP += reward;
    profile.cpWeeklyXP += reward;
    profile.cpMonthlyXP += reward;
    profile.cpDailyXP += reward;
  }

  return reward;
}

/* =========================================
   CP DAILY TASK + BONUS REWARD SYSTEM
========================================= */

function completeCPDailyTask(
  profileA,
  profileB,
  taskId,
  coinReward,
  xpReward
) {
  ensureCPProfile(profileA);
  ensureCPProfile(profileB);

  if (
    profileA.cpPartnerId !== profileB.id ||
    profileB.cpPartnerId !== profileA.id
  ) {
    return {
      ok: false,
      message: "CP Partner not found"
    };
  }

  const today = getIndiaDate();

  const taskIds = [
    "send_cp_gift",
    "save_memory",
    "send_partner_message",
    "voice_10_minutes"
  ];

  for (const profile of [profileA, profileB]) {
    profile.cpDailyTaskClaims ||= {};
    profile.cpDailyBonusClaims ||= {};

    if (profile.cpTaskDate !== today) {
      profile.cpTaskDate = today;
      profile.cpDailyTaskClaims = {};
      profile.cpDailyBonusClaims = {};
    }
  }

  if (
    profileA.cpDailyTaskClaims[taskId] === today ||
    profileB.cpDailyTaskClaims[taskId] === today
  ) {
    return {
      ok: false,
      message: "Aaj ka task reward pehle mil chuka hai."
    };
  }

  const coins = Math.max(
    0,
    Math.floor(Number(coinReward) || 0)
  );

  const xp = Math.max(
    0,
    Math.floor(Number(xpReward) || 0)
  );

  // MARK TASK COMPLETED
  profileA.cpDailyTaskClaims[taskId] = today;
  profileB.cpDailyTaskClaims[taskId] = today;

  const completedCount = taskIds.filter(id =>
    profileA.cpDailyTaskClaims[id] === today
  ).length;

  let bonusCoins = 0;
  let bonusXP = 0;

  // 3 TASK BONUS
  if (
    completedCount >= 3 &&
    !profileA.cpDailyBonusClaims.three_tasks &&
    !profileB.cpDailyBonusClaims.three_tasks
  ) {
    bonusCoins += 25000;
    bonusXP += 5000;

    profileA.cpDailyBonusClaims.three_tasks = today;
    profileB.cpDailyBonusClaims.three_tasks = today;
  }

  // ALL 4 TASKS BONUS
  if (
    completedCount >= 4 &&
    !profileA.cpDailyBonusClaims.all_tasks &&
    !profileB.cpDailyBonusClaims.all_tasks
  ) {
    bonusCoins += 100000;
    bonusXP += 20000;

    profileA.cpDailyBonusClaims.all_tasks = today;
    profileB.cpDailyBonusClaims.all_tasks = today;
  }

  // GIVE REWARDS TO BOTH PARTNERS
  for (const profile of [profileA, profileB]) {
    profile.coins =
      (Number(profile.coins) || 0) + coins + bonusCoins;

    if (coins > 0) {
      addWalletHistory(
        profile,
        "cp-task",
        coins,
        "CP Daily Task Reward"
      );
    }

    if (bonusCoins > 0) {
      addWalletHistory(
        profile,
        "cp-bonus",
        bonusCoins,
        "CP Daily Bonus Reward"
      );
    }
  }

  const xpAdded = addCPTaskExperience(
    profileA,
    profileB,
    xp + bonusXP
  );

  // UPDATE ONLINE USERS
  for (const [socketId, onlineUser] of online.entries()) {
    if (
      onlineUser.id === profileA.id ||
      onlineUser.id === profileB.id
    ) {
      const profile = db.profiles[onlineUser.id];

      if (profile) {
        onlineUser.coins =
          Number(profile.coins) || 0;

        io.to(socketId).emit("profile-update", {
          id: onlineUser.id,
          coins: profile.coins,
          diamonds: profile.diamonds
        });
      }
    }
  }

  saveDB();

  emitCPUpdate(profileA.id);
  emitCPUpdate(profileB.id);

  return {
    ok: true,
    coins: coins + bonusCoins,
    xpAdded,
    bonusCoins,
    bonusXP,
    completedCount
  };
}

function emitCPUpdate(userId) {
  for (const [socketId, user] of online.entries()) {
    if (user.id === userId) {
      io.to(socketId).emit("cp-space-update", {
        updated: true
      });
    }
  }
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
      frameData: getFrameDesign(user.frame || "frame_free"),
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
   
  // STOP CP PARTNER VOICE SESSION
  stopCPVoiceSession(roomId, user?.id);
   
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
        totalExperience: 0,
        claimedLevelRewards: [],
        levelRewardItems: [], 
        walletHistory: [],
        svipUntil: 0,
        medals: [],
        familyId: "",
        redeemedKeys: [],
        feedback: [],
        frame: "frame_free",
        ownedFrames: ["frame_free"],
        bagItems: [],
        equippedCosmetics: {
        vehicle: "",
        chatBubble: "",
        profileCard: "",
        rgbName: "",
        entryEffect: "",
        micEffect: "",
        nameDecoration: "",
        specialEffect: ""
      },
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
      profile.bagItems ||= [];

      profile.equippedCosmetics ||= {
        vehicle: "",
        chatBubble: "",
        profileCard: "",
        rgbName: "",
        entryEffect: "",
        micEffect: "",
        nameDecoration: "",
        specialEffect: ""
      };
      profile.following ||= [];
      profile.taskProgress ||= {};
      profile.claimedTasks ||= [];
      profile.dailyRewardDate ||= "";
      profile.totalExperience = Number(profile.totalExperience) || 0;
      profile.claimedLevelRewards ||= [];
      profile.levelRewardItems ||= [];
      profile.walletHistory ||= [];
      profile.svipUntil = Number(profile.svipUntil) || 0;
      profile.medals ||= [];
      profile.familyId ||= "";
      profile.redeemedKeys ||= [];
      profile.feedback ||= [];
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

    profile.frame ||= "frame_free";
    user.frame = profile.frame;
     
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
   
// =====================================
// GET LEVEL PROGRESS
// =====================================

socket.on("get-level-progress", callback => {
  const user = getUser(socket);

  if (!user) {
    return reply(callback, {
      ok: false,
      message: "Register first"
    });
  }

  const profile = db.profiles[user.id];

  if (!profile) {
    return reply(callback, {
      ok: false,
      message: "Profile not found"
    });
  }

  const progress = getLevelProgress(profile);

  saveDB();

  reply(callback, {
    ok: true,
    level: progress.level,
    xp: progress.totalXP,
    currentXP: progress.currentXP,
    requiredXP: progress.requiredXP,
    xpToNextLevel: Math.max(
      0,
      progress.requiredXP - progress.currentXP
    )
  });
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
    result.levelProgress = getLevelProgress(profile);
   
    result.levelRewards = Array.from({ length: 100 }, (_, index) => {
      const level = index + 1;

      const claimed =
        Array.isArray(profile.claimedLevelRewards) &&
        profile.claimedLevelRewards.includes(level);

      return {
        level,
        coins: level < 2 ? 0 : level * 50000,
        name: level === 1
          ? "Starter Badge"
          : LEVEL_SPECIAL_REWARDS[level - 2],
        owned: level === 1 || claimed
       };
     }); 
     
    // Do not expose private information.
    delete result.taskProgress;
    delete result.walletHistory;
    delete result.feedback;
    delete result.redeemedKeys;

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
    addWalletHistory(profile, "purchase", -frame.price, `Bought ${frame.name}`);
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

    const currentRoom = getRoom(socket);
    if (currentRoom) {
      updateRoom(currentRoom);
    }

    reply(callback, {
      ok: true,
      frame: frameId,
      frameData: getFrameDesign(frameId)
    });
  });
   
/* =========================================
   COMPLETE BAG SYSTEM
========================================= */

// GET BAG
socket.on("get-bag", (data, callback) => {
  const user = getUser(socket);
  const profile = getProfile(socket);

  if (!user || !profile) {
    return reply(callback, {
      ok: false,
      message: "Register first"
    });
  }

  profile.bagItems ||= [];
  profile.ownedFrames ||= ["frame_free"];

  profile.equippedCosmetics ||= {};

  const ownedItems = [
    ...profile.ownedFrames,
    ...profile.bagItems
  ];

  reply(callback, {
    ok: true,
    items: BAG_ITEMS,
    categories: BAG_CATEGORIES,
    ownedItems: [...new Set(ownedItems)],
    equipped: {
      frame: profile.frame || "frame_free",
      ...profile.equippedCosmetics
    },
    coins: Number(profile.coins) || 0
  });
});


// BUY BAG ITEM
socket.on("buy-bag-item", (data, callback) => {
  const user = getUser(socket);
  const profile = getProfile(socket);

  if (!user || !profile) {
    return reply(callback, {
      ok: false,
      message: "Register first"
    });
  }

  const itemId = clean(data?.itemId, 80);
  const item = BAG_ITEMS.find(x => x.id === itemId);

  if (!item) {
    return reply(callback, {
      ok: false,
      message: "Item not found"
    });
  }

  profile.bagItems ||= [];
  profile.ownedFrames ||= ["frame_free"];

  const owned = item.category === "frame"
    ? profile.ownedFrames.includes(item.id)
    : profile.bagItems.includes(item.id);

  if (owned) {
    return reply(callback, {
      ok: false,
      message: "Item already owned"
    });
  }

  const price = Math.max(0, Number(item.price) || 0);

  if (profile.coins < price) {
    return reply(callback, {
      ok: false,
      message: "Not enough Coins"
    });
  }

  profile.coins -= price;

  if (item.category === "frame") {
    profile.ownedFrames.push(item.id);
  } else {
    profile.bagItems.push(item.id);
  }

  addWalletHistory(
    profile,
    "purchase",
    -price,
    `Bought ${item.name}`
  );

  user.coins = profile.coins;

  saveDB();

  socket.emit("profile-update", {
    id: user.id,
    coins: profile.coins
  });

  reply(callback, {
    ok: true,
    message: "Item added to Bag",
    item,
    coins: profile.coins
  });
});


// EQUIP BAG ITEM
socket.on("equip-bag-item", (data, callback) => {
  const user = getUser(socket);
  const profile = getProfile(socket);

  if (!user || !profile) {
    return reply(callback, {
      ok: false,
      message: "Register first"
    });
  }

  const itemId = clean(data?.itemId, 80);
  const item = BAG_ITEMS.find(x => x.id === itemId);

  if (!item) {
    return reply(callback, {
      ok: false,
      message: "Item not found"
    });
  }

  profile.bagItems ||= [];
  profile.ownedFrames ||= ["frame_free"];
  profile.equippedCosmetics ||= {};

  const owned = item.category === "frame"
    ? profile.ownedFrames.includes(item.id)
    : profile.bagItems.includes(item.id);

  if (!owned) {
    return reply(callback, {
      ok: false,
      message: "Buy this item first"
    });
  }

  if (item.category === "frame") {
    profile.frame = item.id;
    user.frame = item.id;
  } else {
    profile.equippedCosmetics[item.category] = item.id;
  }

  saveDB();

  const room = getRoom(socket);

  if (room) {
    updateRoom(room);
  }

  reply(callback, {
    ok: true,
    message: "Item equipped",
    equipped: {
      frame: profile.frame || "frame_free",
      ...profile.equippedCosmetics
    }
  });
});


// UNEQUIP BAG ITEM
socket.on("unequip-bag-item", (data, callback) => {
  const user = getUser(socket);
  const profile = getProfile(socket);

  if (!user || !profile) {
    return reply(callback, {
      ok: false,
      message: "Register first"
    });
  }

  const category = clean(data?.category, 40);

  if (category === "frame") {
    profile.frame = "frame_free";
    user.frame = "frame_free";
  } else if (
    BAG_CATEGORIES.includes(category) &&
    category !== "all"
  ) {
    profile.equippedCosmetics ||= {};
    profile.equippedCosmetics[category] = "";
  } else {
    return reply(callback, {
      ok: false,
      message: "Invalid category"
    });
  }

  saveDB();

  const room = getRoom(socket);

  if (room) {
    updateRoom(room);
  }

  reply(callback, {
    ok: true,
    message: "Item unequipped"
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
    addWalletHistory(profile, "reward", DAILY_REWARD_COINS, "Daily login reward");
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
  
    // START CP PARTNER VOICE SESSION
    startCPVoiceSession(room, user);
     
    room.micStates.set(socket.id, true);

    const joinedProfile = db.profiles[user.id];

    joinedProfile.roomJoins =
      (Number(joinedProfile.roomJoins) || 0) + 1;

    // Give 10 XP for joining a room.
    // Maximum 100 XP per day.
    addExperience(joinedProfile, 10);

    user.level = joinedProfile.level;
    user.coins = Number(joinedProfile.coins) || 0;

    socket.emit("profile-update", {
      id: user.id,
      level: joinedProfile.level,
      coins: joinedProfile.coins
    });
     
    saveDB();
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
      id: user.id,
      name: user.name
    };

    completeTask(user.id, "take_seat");

    reply(callback, { ok: true });

    updateRoom(room);
    saveDB();
  });

  socket.on("leave-seat", (data, callback) => {
    const room = getRoom(socket);

    if (!room) {
      return reply(callback, {
        ok: false,
        message: "Join a room first"
      });
    }

    removeFromSeat(room, socket.id);

    reply(callback, { ok: true });

    updateRoom(room);
  });

  /* =======================================
     CHAT
  ======================================= */

  socket.on("room-message", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);

    const messageText = clean(
      data?.message || data?.text,
      500
    );

    if (!room || !user || !isMember(room, socket) || !messageText) {
      return reply(callback, {
        ok: false,
        message: "Invalid message"
      });
    }

      const message = {
      username: user.name,
      name: user.name,
      userId: user.id,
      message: messageText,
      text: messageText,
      time: Date.now()
    };

    room.messages.push(message);

    if (room.messages.length > 100) {
      room.messages.shift();
    }

    completeTask(user.id, "send_message");

    // CP PARTNER MESSAGE DAILY TASK
    const senderProfile = db.profiles[user.id];

    if (senderProfile) {
      const partnerId = senderProfile.cpPartnerId;
      const partnerProfile = partnerId
        ? db.profiles[partnerId]
        : null;

    if (partnerProfile) {
      completeCPDailyTask(
        senderProfile,
        partnerProfile,
        "send_partner_message",
        10000,
        2000
     );
   }
 }
     
    io.to(room.id).emit("room-message", message);

    saveDB();
    reply(callback, { ok: true });
  });

  /* =======================================
     CLEAR CHAT
  ======================================= */

  socket.on("clear-chat", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);

    if (!room || !isAdmin(room, user)) {
      return reply(callback, {
        ok: false,
        message: "Only Owner/Admin can clear chat"
      });
    }

    room.messages = [];

    io.to(room.id).emit("chat-cleared", {
      by: user.name,
      time: Date.now()
    });

    reply(callback, { ok: true });
  });

  /* =======================================
     EMOJI
  ======================================= */

  socket.on("send-emoji", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const emoji = clean(data?.emoji, 12);

    if (!room || !user || !isMember(room, socket)) {
      return reply(callback, { ok: false });
    }

    if (!ALLOWED_EMOJIS.includes(emoji)) {
      return reply(callback, {
        ok: false,
        message: "Invalid emoji"
      });
    }

    completeTask(user.id, "use_emoji");

    io.to(room.id).emit("emoji-event", {
      username: user.name,
      name: user.name,
      userId: user.id,
      emoji,
      time: Date.now()
    });

    saveDB();
    reply(callback, { ok: true });
  });

  /* =======================================
     GIFTS
  ======================================= */

  socket.on("get-gifts", (data, callback) => {
    reply(callback, {
      ok: true,
      gifts: GIFTS,
      categories: GIFT_CATEGORIES
    });
  });

  socket.on("send-gift", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const profile = getProfile(socket);

    if (!room || !user || !profile || !isMember(room, socket)) {
      return reply(callback, {
        ok: false,
        message: "Join a room first"
      });
    }

    const gift = findGift(data?.giftId || data?.gift);
    const receiverId = clean(
      data?.receiverId || data?.to,
      20
    );

    const quantity = Math.max(
      1,
      Math.min(10, Number(data?.quantity) || 1)
    );

    if (!gift) {
      return reply(callback, {
        ok: false,
        message: "Gift not found"
      });
    }

    const totalCost = gift.price * quantity;

    if (profile.coins < totalCost) {
      return reply(callback, {
        ok: false,
        message: "Not enough coins"
      });
    }

    let receiver = null;

    if (receiverId && receiverId !== "Everyone") {
      for (const socketId of room.members) {
        const member = online.get(socketId);

        if (member?.id === receiverId) {
          receiver = db.profiles[receiverId];
          break;
        }
      }

      if (!receiver) {
        return reply(callback, {
          ok: false,
          message: "Receiver is not in this room"
        });
      }
    }

    profile.coins -= totalCost;
    // CP XP is earned only when gifting to your CP Partner.
    if (
      receiver &&
      profile.cpPartnerId === receiverId &&
      receiver.cpPartnerId === user.id
    ) {
      const cpReward = Math.max(
        1,
        Math.floor(totalCost / 1000)
      );

      addCPExperience(profile, receiver, cpReward);

      emitCPUpdate(user.id);
      emitCPUpdate(receiverId);
    }
    addWalletHistory(profile, "gift", -totalCost, `Sent ${quantity} x ${gift.name}`);

    if (receiver) {
      receiver.diamonds =
        (Number(receiver.diamonds) || 0) + totalCost;

      receiver.totalGifts =
        (Number(receiver.totalGifts) || 0) + quantity;

      receiver.walletHistory ||= [];
      receiver.walletHistory.unshift({
        id: `gift_${Date.now()}`,
        type: "gift",
        amount: totalCost,
        note: `Received ${quantity} x ${gift.name} (Diamonds)`,
        date: Date.now()
      });

      receiver.walletHistory = receiver.walletHistory.slice(0, 100);
    }

    user.coins = profile.coins;

    const rankingId = receiverId || "Everyone";

    const ranking = room.giftRanking.get(rankingId) || {
      userId: rankingId,
      name: receiver?.name || "Everyone",
      gifts: 0,
      coins: 0
    };

    ranking.gifts += quantity;
    ranking.coins += totalCost;

    room.giftRanking.set(rankingId, ranking);

    completeTask(user.id, "send_gift");

    const event = {
      senderName: user.name,
      username: user.name,
      senderId: user.id,
      receiverId: receiverId || null,
      receiverName: receiver?.name || "Everyone",
      giftName: gift.name,
      giftIcon: gift.icon,
      price: gift.price,
      quantity,
      time: Date.now()
    };

    saveDB();

    socket.emit("profile-update", {
      id: user.id,
      name: user.name,
      coins: profile.coins,
      diamonds: profile.diamonds
    });

    io.to(room.id).emit("gift-event", event);
    io.to(room.id).emit("gift-ranking", getRanking(room));

    reply(callback, {
      ok: true,
      coins: profile.coins,
      diamonds: profile.diamonds
    });
  });
   
/* =========================================
   CP PARTNER GIFT SYSTEM
========================================= */

socket.on("send-cp-gift", (data, callback) => {

  const user = getUser(socket);
  const profile = getProfile(socket);

  if (!user || !profile) {
    return reply(callback, {
      ok: false,
      message: "Register first"
    });
  }

  ensureCPProfile(profile);

  const partnerId = profile.cpPartnerId;
  const partner = partnerId
    ? db.profiles[partnerId]
    : null;

  if (
    !partner ||
    partner.cpPartnerId !== user.id
  ) {
    return reply(callback, {
      ok: false,
      message: "CP Partner not found"
    });
  }

  const gift = findGift(data?.giftId);

  if (!gift) {
    return reply(callback, {
      ok: false,
      message: "Gift not found"
    });
  }

  const quantity = Math.max(
    1,
    Math.min(10, Number(data?.quantity) || 1)
  );

  const totalCost = gift.price * quantity;

  if (
    !Number.isSafeInteger(totalCost) ||
    totalCost <= 0 ||
    Number(profile.coins || 0) < totalCost
  ) {
    return reply(callback, {
      ok: false,
      message: "Not enough coins"
    });
  }

  // Deduct sender coins.
  profile.coins -= totalCost;

  // Add receiver diamonds.
  partner.diamonds =
    (Number(partner.diamonds) || 0) + totalCost;

  partner.totalGifts =
    (Number(partner.totalGifts) || 0) + quantity;

  // Wallet history.
  addWalletHistory(
    profile,
    "gift",
    -totalCost,
    `Sent ${quantity} x ${gift.name} to CP Partner`
  );

  partner.walletHistory ||= [];

  partner.walletHistory.unshift({
    id: `cp_gift_${Date.now()}`,
    type: "gift",
    amount: totalCost,
    note: `Received ${quantity} x ${gift.name} from CP Partner`,
    date: Date.now()
  });

  partner.walletHistory =
    partner.walletHistory.slice(0, 100);

  // CP XP reward.
  const cpReward = Math.max(
    1,
    Math.floor(totalCost / 1000)
  );

  const xpAdded = addCPExperience(
    profile,
    partner,
    cpReward
  );
   
  // CP DAILY GIFT TASK REWARD
  const giftTaskReward = completeCPDailyTask(
    profile,
    partner,
    "send_cp_gift",
    10000,
    2000
  );
   
  // Update online user coins.
  user.coins = profile.coins;

  const event = {
    senderId: user.id,
    senderName: user.name,
    receiverId: partner.id,
    receiverName: partner.name,
    giftId: gift.id,
    giftName: gift.name,
    giftIcon: gift.icon,
    quantity,
    totalCost,
    xpAdded,
    time: Date.now()
  };

  saveDB();

  // Update sender.
  socket.emit("profile-update", {
    id: user.id,
    coins: profile.coins,
    diamonds: profile.diamonds
  });

  socket.emit("cp-gift-sent", event);

  // Notify partner on all their active connections.
  for (const [socketId, onlineUser] of online.entries()) {
    if (onlineUser.id === partner.id) {
      io.to(socketId).emit("cp-gift-received", event);
      io.to(socketId).emit("profile-update", {
        id: partner.id,
        coins: partner.coins,
        diamonds: partner.diamonds
      });
    }
  }

  emitCPUpdate(user.id);
  emitCPUpdate(partner.id);

  reply(callback, {
    ok: true,
    message: "CP Gift sent successfully",
    coins: profile.coins,
    diamonds: partner.diamonds,
    xpAdded
  });

});
   
  /* =======================================
     MIC STATE
  ======================================= */    

    socket.on("mic-state", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);

    if (!room || !user || !isMember(room, socket)) {
      return reply(callback, { ok: false });
    }

    const micOn = data?.micOn !== undefined
      ? Boolean(data.micOn)
      : !Boolean(data?.muted);

    room.micStates.set(socket.id, micOn);

    io.to(room.id).emit("mic-update", {
      socketId: socket.id,
      userId: user.id,
      micOn
    });

    reply(callback, { ok: true });
  });

  /* =======================================
     FORCE MUTE
  ======================================= */

  socket.on("force-mute", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const targetId = clean(data?.userId, 20);

    if (!room || !isAdmin(room, user)) {
      return reply(callback, {
        ok: false,
        message: "Permission denied"
      });
    }

    let found = false;

    for (const socketId of room.members) {
      const member = online.get(socketId);

      if (member?.id === targetId) {
        room.micStates.set(socketId, false);

        io.to(socketId).emit("force-mute", {
          muted: true
        });

        io.to(room.id).emit("mic-update", {
          socketId,
          userId: targetId,
          micOn: false
        });

        found = true;
        break;
      }
    }

    reply(callback, {
      ok: found,
      message: found ? "Muted" : "User not found"
    });
  });

  /* =======================================
     ADMIN MANAGEMENT
  ======================================= */

  socket.on("add-room-admin", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const targetId = clean(data?.userId, 20);

    if (!room || !isOwner(room, user)) {
      return reply(callback, {
        ok: false,
        message: "Only owner can add admins"
      });
    }

    if (!db.profiles[targetId] || targetId === room.ownerId) {
      return reply(callback, {
        ok: false,
        message: "User not found"
      });
    }

    room.admins.add(targetId);

    reply(callback, { ok: true });

    updateRoom(room);
  });

  socket.on("remove-room-admin", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const targetId = clean(data?.userId, 20);

    if (!room || !isOwner(room, user)) {
      return reply(callback, {
        ok: false,
        message: "Only owner can remove admins"
      });
    }

    room.admins.delete(targetId);

    reply(callback, { ok: true });

    updateRoom(room);
  });

  /* =======================================
     KICK MEMBER
  ======================================= */

  socket.on("kick-member", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);
    const targetId = clean(data?.userId, 20);

    if (!room || !isAdmin(room, user)) {
      return reply(callback, {
        ok: false,
        message: "Permission denied"
      });
    }

    if (targetId === room.ownerId) {
      return reply(callback, {
        ok: false,
        message: "Owner cannot be kicked"
      });
    }

    let found = false;

    for (const socketId of room.members) {
      const member = online.get(socketId);

      if (member?.id === targetId) {
        const targetSocket = io.sockets.sockets.get(socketId);

        if (targetSocket) {
          targetSocket.emit("kicked-from-room", {
            message: "You were removed from this room"
          });

          leaveRoom(targetSocket);
        }

        found = true;
        break;
      }
    }

    reply(callback, {
      ok: found,
      message: found ? "Member removed" : "Member not found"
    });
  });

  /* =======================================
     MIC CONTROL
  ======================================= */

  socket.on("toggle-mic", (data, callback) => {
    const room = getRoom(socket);

    if (!room || !isMember(room, socket)) {
      return reply(callback, {
        ok: false,
        message: "Join a room first"
      });
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

  /* =======================================
     ROOM SETTINGS
  ======================================= */

  socket.on("update-room-settings", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);

    if (!room || !isAdmin(room, user)) {
      return reply(callback, {
        ok: false,
        message: "Only Owner/Admin can update settings"
      });
    }

    if (data.name !== undefined) {
      room.name = clean(data.name, 35) || room.name;
    }

    if (data.description !== undefined) {
      room.settings.description = clean(data.description, 150);
    }

    if (data.locked !== undefined) {
      if (!isOwner(room, user)) {
        return reply(callback, {
          ok: false,
          message: "Only owner can lock the room"
        });
      }

      room.settings.locked = Boolean(data.locked);
    }

    if (data.youtubeAllowed !== undefined) {
      room.settings.allowYoutube = Boolean(data.youtubeAllowed);
    }

    if (data.allowYoutube !== undefined) {
      room.settings.allowYoutube = Boolean(data.allowYoutube);
  } 

        if (data.seats !== undefined) {
      if (!isOwner(room, user)) {
        return reply(callback, {
          ok: false,
          message: "Only owner can change seat count"
        });
      }

      const count = Number(data.seats);

      if (!ALLOWED_SEATS.includes(count)) {
        return reply(callback, {
          ok: false,
          message: "Choose 9, 11, 15 or 20 seats"
        });
      }

      if (count < room.seats.length) {
        const removedSeats = room.seats.slice(count);

        if (removedSeats.some(Boolean)) {
          return reply(callback, {
            ok: false,
            message: "Some seats are occupied"
          });
        }
      }

      room.seats = Array(count)
        .fill(null)
        .map((_, index) => room.seats[index] || null);
    }

    reply(callback, {
      ok: true,
      message: "Settings updated"
    });

    updateRoom(room);
  });

  /* =======================================
     YOUTUBE SHARING
  ======================================= */

  socket.on("share-youtube", (data, callback) => {
    const room = getRoom(socket);
    const user = getUser(socket);

    if (!room || !user || !isMember(room, socket)) {
      return reply(callback, {
        ok: false,
        message: "Join a room first"
      });
    }

    if (!room.settings.allowYoutube) {
      return reply(callback, {
        ok: false,
        message: "YouTube sharing is disabled"
      });
    }

    if (!isAdmin(room, user)) {
      return reply(callback, {
        ok: false,
        message: "Only Owner/Admin can share links"
      });
    }

    let url;

    try {
      url = new URL(clean(data?.url, 500));
    } catch {
      return reply(callback, {
        ok: false,
        message: "Invalid link"
      });
    }

    const validHosts = [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "youtu.be",
      "www.youtu.be"
    ];

    if (url.protocol !== "https:" || !validHosts.includes(url.hostname)) {
      return reply(callback, {
        ok: false,
        message: "Only YouTube links are allowed"
      });
    }

    const event = {
      url: url.toString(),
      by: user.name,
      username: user.name,
      time: Date.now()
    };

    io.to(room.id).emit("youtube-shared", event);
    io.to(room.id).emit("youtube-link", event);

    reply(callback, { ok: true });
  });

  /* =======================================
     INBOX
  ======================================= */

  socket.on("get-inbox", callback => {
    const user = getUser(socket);

    if (!user) {
      return reply(callback, {
        ok: false,
        message: "Register first"
      });
    }

    const messages = db.inbox[user.id] || [];

    socket.emit("inbox-messages", messages);
    socket.emit("inbox-data", messages);

    reply(callback, {
      ok: true,
      messages
    });
  });

  socket.on("send-dm", (data, callback) => {
    const user = getUser(socket);
    const targetId = clean(data?.to, 20);
    const messageText = clean(data?.text, 500);

    if (!user || !db.profiles[targetId] || !messageText) {
      return reply(callback, {
        ok: false,
        message: "Invalid message"
      });
    }

    const message = {
      from: user.name,
      fromId: user.id,
      to: db.profiles[targetId].name,
      toId: targetId,
      message: messageText,
      text: messageText,
      time: Date.now()
    };

    db.inbox[targetId] ||= [];
    db.inbox[user.id] ||= [];

    db.inbox[targetId].push(message);
    db.inbox[user.id].push(message);

    db.inbox[targetId] = db.inbox[targetId].slice(-500);
    db.inbox[user.id] = db.inbox[user.id].slice(-500);

    saveDB();

    for (const [socketId, onlineUser] of online.entries()) {
      if (onlineUser.id === targetId) {
        io.to(socketId).emit("new-dm", message);
      }
    }

    reply(callback, {
      ok: true,
      message
    });
  }); 

     /* =======================================
     WEBRTC SIGNALING
  ======================================= */

  socket.on("voice-offer", data => {
    const room = getRoom(socket);
    if (!room || !isMember(room, socket)) return;

    const targetId = clean(data?.to || data?.targetId, 100);
    const target = io.sockets.sockets.get(targetId);

    if (
      !target ||
      target.data.roomId !== room.id ||
      !data?.offer
    ) return;

    target.emit("voice-offer", {
      from: socket.id,
      offer: data.offer
    });
  });

  socket.on("voice-answer", data => {
    const room = getRoom(socket);
    if (!room || !isMember(room, socket)) return;

    const targetId = clean(data?.to || data?.targetId, 100);
    const target = io.sockets.sockets.get(targetId);

    if (
      !target ||
      target.data.roomId !== room.id ||
      !data?.answer
    ) return;

    target.emit("voice-answer", {
      from: socket.id,
      answer: data.answer
    });
  });

  socket.on("voice-ice", data => {
    const room = getRoom(socket);
    if (!room || !isMember(room, socket)) return;

    const targetId = clean(data?.to || data?.targetId, 100);
    const target = io.sockets.sockets.get(targetId);

    if (
      !target ||
      target.data.roomId !== room.id ||
      !data?.candidate
    ) return;

    target.emit("voice-ice", {
      from: socket.id,
      candidate: data.candidate
    });
  });

  /* =======================================
     PROFILE EXTRAS: WALLET / SVIP / MEDALS / FAMILY / CD KEY
  ======================================= */

  socket.on("get-wallet-history", callback => {
    const profile = getProfile(socket);
    if (!profile) return reply(callback, { ok: false, message: "Register first" });
    reply(callback, { ok: true, coins: Number(profile.coins) || 0, diamonds: Number(profile.diamonds) || 0, history: profile.walletHistory || [] });
  });

  socket.on("get-svip", callback => {
    const profile = getProfile(socket);
    if (!profile) return reply(callback, { ok: false, message: "Register first" });
    reply(callback, { ok: true, active: Number(profile.svipUntil) > Date.now(), until: Number(profile.svipUntil) || 0, coins: Number(profile.coins) || 0, plans: [{ id: "svip7", name: "SVIP 7 Days", days: 7, price: 500000 }, { id: "svip30", name: "SVIP 30 Days", days: 30, price: 1500000 }] });
  });

  socket.on("buy-svip", (data, callback) => {
    const profile = getProfile(socket);
    const user = getUser(socket);
    if (!profile || !user) return reply(callback, { ok: false, message: "Register first" });
    const plans = { svip7: { days: 7, price: 500000, name: "SVIP 7 Days" }, svip30: { days: 30, price: 1500000, name: "SVIP 30 Days" } };
    const plan = plans[clean(data?.planId, 20)];
    if (!plan) return reply(callback, { ok: false, message: "Invalid SVIP plan" });
    if ((Number(profile.coins) || 0) < plan.price) return reply(callback, { ok: false, message: "Not enough virtual Coins" });
    profile.coins -= plan.price;
    const start = Math.max(Date.now(), Number(profile.svipUntil) || 0);
    profile.svipUntil = start + plan.days * 86400000;
    addWalletHistory(profile, "purchase", -plan.price, `Bought ${plan.name}`);
    user.coins = profile.coins;
    saveDB();
    socket.emit("profile-update", { id: user.id, coins: profile.coins, svipUntil: profile.svipUntil });
    reply(callback, { ok: true, coins: profile.coins, until: profile.svipUntil });
  });

  socket.on("get-medals", callback => {
    const p = getProfile(socket);
    if (!p) return reply(callback, { ok: false });
    const medals = [
      { id: "first_room", name: "Room Explorer", icon: "🎙️", description: "Join a voice room", earned: (p.roomJoins || 0) > 0 },
      { id: "gifter", name: "Gift Sender", icon: "🎁", description: "Send a gift", earned: (p.totalGifts || 0) > 0 },
      { id: "svip", name: "SVIP Member", icon: "👑", description: "Have an active SVIP membership", earned: (p.svipUntil || 0) > Date.now() }
    ];
    reply(callback, { ok: true, medals });
  });

/* =========================================
   HUKA FAMILY SYSTEM
   Owner + Admin + Members + Family Chat
========================================= */

function getFamilyMemberInfo(memberId, family) {
  const profile = db.profiles[String(memberId)] || {};

  return {
    id: memberId,
    name: profile.username || profile.name || "Huka User",
    avatar: profile.avatar || profile.dp || "",
    role: memberId === family.ownerId
      ? "Owner"
      : (family.admins || []).includes(memberId)
        ? "Admin"
        : "Member"
  };
}

function getFamilyData(family) {
  if (!family) return null;

  family.members ||= [];
  family.admins ||= [];
  family.chat ||= [];

  return {
    id: family.id,
    name: family.name,
    code: family.code,
    ownerId: family.ownerId,
    members: family.members.map(id =>
      getFamilyMemberInfo(id, family)
    ),
    memberCount: family.members.length,
    admins: family.admins,
    createdAt: family.createdAt
  };
}

function familyBroadcast(family) {
  if (!family) return;

  io.to("family_" + family.id).emit(
    "family:updated",
    getFamilyData(family)
  );
}

/* =========================================
   GET FAMILY
========================================= */

socket.on("get-family", callback => {
  const p = getProfile(socket);
  const u = getUser(socket);

  if (!p || !u) {
    return reply(callback, {
      ok: false,
      message: "Register first"
    });
  }

  const family = p.familyId
    ? db.families[p.familyId]
    : null;

  if (!family) {
    return reply(callback, {
      ok: true,
      family: null
    });
  }

  family.members ||= [];
  family.admins ||= [];
  family.chat ||= [];

  socket.join("family_" + family.id);

  reply(callback, {
    ok: true,
    family: getFamilyData(family),
    chat: family.chat.slice(-50)
  });
});


/* CREATE FAMILY */

socket.on("create-family", (data, callback) => {
  const p = getProfile(socket);
  const u = getUser(socket);

  if (!p || !u) {
    return reply(callback, {
      ok: false,
      message: "Register first"
    });
  }

  if (p.familyId && db.families[p.familyId]) {
    return reply(callback, {
      ok: false,
      message: "Leave your current family first"
    });
  }

  const name = clean(data?.name, 30);

  if (name.length < 3) {
    return reply(callback, {
      ok: false,
      message: "Family name must be at least 3 characters"
    });
  }

  const id = "F" + Date.now() +
    Math.random().toString(36).slice(2, 6).toUpperCase();

  let code;

  do {
    code = Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase();
  } while (
    Object.values(db.families).some(f => f.code === code)
  );

  const family = {
    id,
    name,
    code,
    ownerId: u.id,
    admins: [],
    members: [u.id],
    chat: [],
    createdAt: Date.now()
  };

  db.families[id] = family;
  p.familyId = id;

  socket.join("family_" + id);

  saveDB();

  reply(callback, {
    ok: true,
    family: getFamilyData(family)
  });

  familyBroadcast(family);
});


/* =========================================
   JOIN FAMILY
========================================= */

socket.on("join-family", (data, callback) => {
  const p = getProfile(socket);
  const u = getUser(socket);

  if (!p || !u) {
    return reply(callback, {
      ok: false,
      message: "Register first"
    });
  }

  if (p.familyId && db.families[p.familyId]) {
    return reply(callback, {
      ok: false,
      message: "You are already in a family"
    });
  }

  const code = clean(data?.code, 12).toUpperCase();

  const family = Object.values(db.families)
    .find(f => f.code === code);

  if (!family) {
    return reply(callback, {
      ok: false,
      message: "Family code not found"
    });
  }

  family.members ||= [];
  family.admins ||= [];
  family.chat ||= [];

  if (family.members.length >= 50) {
    return reply(callback, {
      ok: false,
      message: "Family is full"
    });
  }

  if (family.members.some(id => String(id) === String(u.id))) {
    return reply(callback, {
      ok: false,
      message: "Already a family member"
    });
  }

  family.members.push(u.id);
  p.familyId = family.id;

  socket.join("family_" + family.id);

  saveDB();

  reply(callback, {
    ok: true,
    family: getFamilyData(family)
  });

  familyBroadcast(family);
});


/* =========================================
   PROMOTE MEMBER TO ADMIN - OWNER ONLY
========================================= */

socket.on("family-promote-admin", (data, callback) => {
  const p = getProfile(socket);
  const u = getUser(socket);

  if (!p || !u || !p.familyId) {
    return reply(callback, {
      ok: false,
      message: "Family not found"
    });
  }

  const family = db.families[p.familyId];

  if (!family || String(family.ownerId) !== String(u.id)) {
    return reply(callback, {
      ok: false,
      message: "Only Owner can manage Admins"
    });
  }

  const memberId = String(data?.memberId || "");

  if (!family.members.some(id => String(id) === memberId)) {
    return reply(callback, {
      ok: false,
      message: "Member not found"
    });
  }

  family.admins ||= [];

  if (String(family.ownerId) === memberId) {
    return reply(callback, {
      ok: false,
      message: "Owner is already the highest role"
    });
  }

  if (family.admins.some(id => String(id) === memberId)) {
    return reply(callback, {
      ok: false,
      message: "This member is already an Admin"
    });
  }

  family.admins.push(memberId);

  saveDB();

  reply(callback, {
    ok: true,
    message: "Member promoted to Admin"
  });

  familyBroadcast(family);
});
   

/* REMOVE ADMIN - OWNER ONLY */

socket.on("family-remove-admin", (data, callback) => {
  const p = getProfile(socket);
  const u = getUser(socket);

  if (!p || !u || !p.familyId) {
    return reply(callback, {
      ok: false,
      message: "Family not found"
    });
  }

  const family = db.families[p.familyId];

  if (!family || family.ownerId !== u.id) {
    return reply(callback, {
      ok: false,
      message: "Only Owner can remove Admins"
    });
  }

  const memberId = String(data?.memberId);

  family.admins = (family.admins || [])
    .filter(id => String(id) !== memberId);

  saveDB();

  reply(callback, {
    ok: true,
    message: "Admin removed"
  });

  familyBroadcast(family);
});


/* REMOVE FAMILY MEMBER */

socket.on("family-remove-member", (data, callback) => {
  const p = getProfile(socket);
  const u = getUser(socket);

  if (!p || !u || !p.familyId) {
    return reply(callback, {
      ok: false,
      message: "Family not found"
    });
  }

  const family = db.families[p.familyId];

  if (!family) {
    return reply(callback, {
      ok: false,
      message: "Family not found"
    });
  }

  const memberId = String(data?.memberId);
  const isOwner = String(family.ownerId) === String(u.id);
  const isAdmin = (family.admins || [])
    .some(id => String(id) === String(u.id));

  if (!isOwner && !isAdmin) {
    return reply(callback, {
      ok: false,
      message: "Only Owner or Admin can remove members"
    });
  }

  if (memberId === String(family.ownerId)) {
    return reply(callback, {
      ok: false,
      message: "Owner cannot be removed"
    });
  }

  const targetIsAdmin = (family.admins || [])
    .some(id => String(id) === memberId);

  if (targetIsAdmin && !isOwner) {
    return reply(callback, {
      ok: false,
      message: "Only Owner can remove an Admin"
    });
  }

  if (!family.members.some(id => String(id) === memberId)) {
    return reply(callback, {
      ok: false,
      message: "Member not found"
    });
  }

  family.members = family.members
    .filter(id => String(id) !== memberId);

  family.admins = (family.admins || [])
    .filter(id => String(id) !== memberId);

  Object.values(db.profiles).forEach(profile => {
    if (String(profile.id) === memberId) {
      profile.familyId = "";
    }
  });

  saveDB();

  reply(callback, {
    ok: true,
    message: "Member removed"
  });

  familyBroadcast(family);
});


/* FAMILY CHAT */

socket.on("family-chat", (data, callback) => {
  const p = getProfile(socket);
  const u = getUser(socket);

  if (!p || !u || !p.familyId) {
    return reply(callback, {
      ok: false,
      message: "Join a family first"
    });
  }

  const family = db.families[p.familyId];

  if (!family || !family.members.includes(u.id)) {
    return reply(callback, {
      ok: false,
      message: "Family not found"
    });
  }

  const message = clean(data?.message, 300);

  if (!message) {
    return reply(callback, {
      ok: false,
      message: "Write a message first"
    });
  }

  family.chat ||= [];

  const chatMessage = {
    id: "FC" + Date.now(),
    userId: u.id,
    username: p.username || p.name || "Huka User",
    message,
    time: Date.now()
  };

  family.chat.push(chatMessage);

  family.chat = family.chat.slice(-100);

  saveDB();

  io.to("family_" + family.id).emit(
    "family:chat",
    chatMessage
  );

  reply(callback, {
    ok: true
  });
});


/* LEAVE FAMILY */

socket.on("leave-family", callback => {
  const p = getProfile(socket);
  const u = getUser(socket);

  if (!p || !u || !p.familyId) {
    return reply(callback, {
      ok: false,
      message: "You are not in a family"
    });
  }

  const family = db.families[p.familyId];

  if (family) {
    family.members ||= [];
    family.admins ||= [];

    family.members = family.members
      .filter(id => String(id) !== String(u.id));

    family.admins = family.admins
      .filter(id => String(id) !== String(u.id));

    if (String(family.ownerId) === String(u.id)) {
      const nextOwner =
        family.admins[0] || family.members[0];

      if (nextOwner) {
        family.ownerId = nextOwner;
        family.admins = family.admins
          .filter(id => String(id) !== String(nextOwner));
      }
    }

    socket.leave("family_" + family.id);

    if (family.members.length === 0) {
      delete db.families[family.id];
    } else {
      familyBroadcast(family);
    }
  }

  p.familyId = "";

  saveDB();

  reply(callback, {
    ok: true,
    message: "You left the family"
  });
});

  socket.on("redeem-cdkey", (data, callback) => {
    const p = getProfile(socket); const u = getUser(socket);
    if (!p || !u) return reply(callback, { ok: false, message: "Register first" });
    const code = clean(data?.code, 30).toUpperCase(); const key = db.cdKeys[code];
    if (!key) return reply(callback, { ok: false, message: "Invalid CD-KEY" });
    key.usedBy ||= []; p.redeemedKeys ||= [];
    if (key.usedBy.includes(u.id) || p.redeemedKeys.includes(code)) return reply(callback, { ok: false, message: "This key has already been used" });
    const reward = Math.max(0, Number(key.reward) || 0);
    key.usedBy.push(u.id); p.redeemedKeys.push(code); p.coins = (Number(p.coins) || 0) + reward; u.coins = p.coins;
    addWalletHistory(p, "reward", reward, `CD-KEY ${code}`); saveDB();
    socket.emit("profile-update", { id: u.id, coins: p.coins });
    reply(callback, { ok: true, reward, coins: p.coins, message: `You received ${reward.toLocaleString()} Coins` });
  });

  socket.on("send-profile-feedback", (data, callback) => {
    const p = getProfile(socket); const u = getUser(socket);
    if (!p || !u) return reply(callback, { ok: false, message: "Register first" });
    const message = clean(data?.message, 500);
    if (message.length < 5) return reply(callback, { ok: false, message: "Please enter at least 5 characters" });
    p.feedback ||= []; p.feedback.unshift({ message, date: Date.now() }); p.feedback = p.feedback.slice(0, 20); saveDB();
    reply(callback, { ok: true, message: "Feedback submitted" });
  });

   
/* =========================================
   CP SPACE REQUESTS AND PARTNERS
========================================= */

// GET CP SPACE
socket.on("get-cp-space", (data, callback) => {
  const user = getUser(socket);
  const profile = getProfile(socket);

  if (!user || !profile) {
    return reply(callback, {
      ok: false,
      message: "Register first"
    });
  }

  ensureCPProfile(profile);

  const today = getIndiaDate();

  profile.cpDailyTaskClaims ||= {};
  profile.cpDailyBonusClaims ||= {};

  if (profile.cpTaskDate !== today) {
    profile.cpTaskDate = today;
    profile.cpDailyTaskClaims = {};
    profile.cpDailyBonusClaims = {};
  }

  // CURRENT USER DETAILS
  const selfData = {
    id: user.id,
    name: profile.name || user.name || "Huka User",
    avatar: profile.avatar || ""
  };

  // CP PARTNER
  const partner = profile.cpPartnerId
    ? db.profiles[profile.cpPartnerId]
    : null;

  const incomingRequests = Object.values(db.cpRequests)
    .filter(request => request.toId === user.id)
    .map(request => ({
      id: request.id,
      fromId: request.fromId,
      fromName: db.profiles[request.fromId]?.name || "Huka User",
      fromAvatar: db.profiles[request.fromId]?.avatar || ""
    }));

  const outgoingRequests = Object.values(db.cpRequests)
    .filter(request => request.fromId === user.id)
    .map(request => ({
      id: request.id,
      toId: request.toId,
      toName: db.profiles[request.toId]?.name || "Huka User"
    }));

  let partnerData = null;

  if (partner && partner.cpPartnerId === user.id) {
    ensureCPProfile(partner);

    const pairedAt = Number(profile.cpPairedAt) || 0;

    const daysTogether = pairedAt
      ? Math.max(
          1,
          Math.floor((Date.now() - pairedAt) / 86400000) + 1
        )
      : 0;

    partnerData = {
      id: partner.id,
      name: partner.name || "CP Partner",
      avatar: partner.avatar || "",
      level: getCPLevel(profile.cpXP),
      xp: profile.cpXP,
      pairedAt,
      daysTogether,
      anniversaryDate: pairedAt
        ? new Date(pairedAt).toISOString().slice(0, 10)
        : "",
      memories: profile.cpMemories || []
    };
  }

  saveDB();

  reply(callback, {
    ok: true,

    // USER AND PARTNER
    self: selfData,
    partner: partnerData,

    pairedAt: profile.cpPairedAt || 0,
    progress: getCPProgress(profile),

    incomingRequests,
    outgoingRequests,

    // CP DAILY TASK STATUS
    taskDate: profile.cpTaskDate,
    dailyTaskClaims: profile.cpDailyTaskClaims || {},
    dailyBonusClaims: profile.cpDailyBonusClaims || {}
  });
});

   
/* =========================================
   CP MEMORIES SYSTEM
========================================= */

// SAVE CP MEMORY
socket.on("add-cp-memory", (data, callback) => {
  const user = getUser(socket);
  const profile = getProfile(socket);

  if (!user || !profile) {
    return reply(callback, {
      ok: false,
      message: "Register first"
    });
  }

  ensureCPProfile(profile);

  const partner = db.profiles[profile.cpPartnerId];

  if (!partner || partner.cpPartnerId !== user.id) {
    return reply(callback, {
      ok: false,
      message: "CP Partner not found"
    });
  }

  const title = String(data?.title || "").trim().slice(0, 60);
  const description = String(data?.description || "")
    .trim()
    .slice(0, 300);

  if (!title) {
    return reply(callback, {
      ok: false,
      message: "Memory title required"
    });
  }

  const memory = {
    id: "cp_memory_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    title,
    description,
    createdBy: user.id,
    createdByName: user.name,
    createdAt: Date.now()
  };

  profile.cpMemories.unshift(memory);
  partner.cpMemories ||= [];
  partner.cpMemories.unshift({ ...memory });

  profile.cpMemories = profile.cpMemories.slice(0, 50);
  partner.cpMemories = partner.cpMemories.slice(0, 50);
 
  // CP MEMORY DAILY TASK REWARD
  const taskReward = completeCPDailyTask(
    profile,
    partner,
    "save_memory",
    10000,
    2000
  );

  if (!taskReward.ok) {
    console.log("CP Memory Task:", taskReward.message);
            }
   
  saveDB();

  emitCPUpdate(user.id);
  emitCPUpdate(partner.id);

  reply(callback, {
    ok: true,
    message: "CP Memory saved successfully",
    memory
  });
});


// DELETE CP MEMORY
socket.on("delete-cp-memory", (data, callback) => {
  const user = getUser(socket);
  const profile = getProfile(socket);

  if (!user || !profile) {
    return reply(callback, {
      ok: false,
      message: "Register first"
    });
  }

  ensureCPProfile(profile);

  const partner = db.profiles[profile.cpPartnerId];

  if (!partner || partner.cpPartnerId !== user.id) {
    return reply(callback, {
      ok: false,
      message: "CP Partner not found"
    });
  }

  const memoryId = String(data?.memoryId || "");

  const memory = profile.cpMemories.find(
    item => item.id === memoryId
  );

  if (!memory) {
    return reply(callback, {
      ok: false,
      message: "Memory not found"
    });
  }

  profile.cpMemories = profile.cpMemories.filter(
    item => item.id !== memoryId
  );

  partner.cpMemories = (partner.cpMemories || []).filter(
    item => item.id !== memoryId
  );

  saveDB();

  emitCPUpdate(user.id);
  emitCPUpdate(partner.id);

  reply(callback, {
    ok: true,
    message: "CP Memory deleted"
  });
});

   
// SEND CP REQUEST
socket.on("send-cp-request", (data, callback) => {
  const user = getUser(socket);
  const profile = getProfile(socket);

  if (!user || !profile) {
    return reply(callback, {
      ok: false,
      message: "Register first"
    });
  }

  const targetId = clean(data?.userId, 20);
  const target = db.profiles[targetId];

  if (!target || targetId === user.id) {
    return reply(callback, {
      ok: false,
      message: "Invalid user"
    });
  }

  ensureCPProfile(profile);
  ensureCPProfile(target);

  if (profile.cpPartnerId || target.cpPartnerId) {
    return reply(callback, {
      ok: false,
      message: "One of the users already has a CP Partner"
    });
  }

  const existing = Object.values(db.cpRequests).find(request =>
    (request.fromId === user.id && request.toId === targetId) ||
    (request.fromId === targetId && request.toId === user.id)
  );

  if (existing) {
    return reply(callback, {
      ok: false,
      message: "A CP request is already pending"
    });
  }

  const requestId =
    "CP_" + Date.now() + "_" +
    Math.random().toString(36).slice(2, 8);

  db.cpRequests[requestId] = {
    id: requestId,
    fromId: user.id,
    toId: targetId,
    createdAt: Date.now()
  };

  saveDB();

  emitCPUpdate(targetId);

  reply(callback, {
    ok: true,
    message: "CP Request sent",
    requestId
  });
});


// ACCEPT OR REJECT CP REQUEST
socket.on("respond-cp-request", (data, callback) => {
  const user = getUser(socket);
  const profile = getProfile(socket);

  if (!user || !profile) {
    return reply(callback, {
      ok: false,
      message: "Register first"
    });
  }

  const requestId = clean(data?.requestId, 100);
  const request = db.cpRequests[requestId];

  if (!request || request.toId !== user.id) {
    return reply(callback, {
      ok: false,
      message: "CP request not found"
    });
  }

  const sender = db.profiles[request.fromId];

  if (!sender) {
    delete db.cpRequests[requestId];
    saveDB();

    return reply(callback, {
      ok: false,
      message: "User not found"
    });
  }

  if (data?.accept !== true) {
    delete db.cpRequests[requestId];
    saveDB();

    emitCPUpdate(request.fromId);

    return reply(callback, {
      ok: true,
      message: "CP request rejected"
    });
  }

  ensureCPProfile(profile);
  ensureCPProfile(sender);

  if (profile.cpPartnerId || sender.cpPartnerId) {
    return reply(callback, {
      ok: false,
      message: "One of the users already has a CP Partner"
    });
  }

  profile.cpPartnerId = sender.id;
  sender.cpPartnerId = user.id;

  profile.cpXP = 0;
  sender.cpXP = 0;

  profile.cpWeeklyXP = 0;
  sender.cpWeeklyXP = 0;

  profile.cpMonthlyXP = 0;
  sender.cpMonthlyXP = 0;

  profile.cpDailyXP = 0;
  sender.cpDailyXP = 0;

  profile.cpPairedAt = Date.now();
  sender.cpPairedAt = Date.now();

  // Remove requests involving either partner.
  for (const [id, item] of Object.entries(db.cpRequests)) {
    if (
      item.fromId === user.id ||
      item.toId === user.id ||
      item.fromId === sender.id ||
      item.toId === sender.id
    ) {
      delete db.cpRequests[id];
    }
  }

  saveDB();

  emitCPUpdate(user.id);
  emitCPUpdate(sender.id);

  reply(callback, {
    ok: true,
    message: "CP Partner connected"
  });
});


// UNPAIR CP PARTNER
socket.on("unpair-cp", (data, callback) => {
  const user = getUser(socket);
  const profile = getProfile(socket);

  if (!user || !profile) {
    return reply(callback, {
      ok: false,
      message: "Register first"
    });
  }

  const partnerId = profile.cpPartnerId;

  if (!partnerId) {
    return reply(callback, {
      ok: false,
      message: "You do not have a CP Partner"
    });
  }

  const partner = db.profiles[partnerId];

  profile.cpPartnerId = "";
  profile.cpXP = 0;
  profile.cpWeeklyXP = 0;
  profile.cpMonthlyXP = 0;
  profile.cpDailyXP = 0;

  if (partner && partner.cpPartnerId === user.id) {
    partner.cpPartnerId = "";
    partner.cpXP = 0;
    partner.cpWeeklyXP = 0;
    partner.cpMonthlyXP = 0;
    partner.cpDailyXP = 0;
  }

  saveDB();

  emitCPUpdate(user.id);
  emitCPUpdate(partnerId);

  reply(callback, {
    ok: true,
    message: "CP Partner removed"
  });
});


// CP WEEKLY AND MONTHLY RANKING
socket.on("get-cp-ranking", (data, callback) => {
  const period = data?.period === "monthly"
    ? "monthly"
    : "weekly";

  const pairs = [];
  const added = new Set();

  for (const profile of Object.values(db.profiles)) {
    ensureCPProfile(profile);

    const partnerId = profile.cpPartnerId;
    if (!partnerId || added.has(profile.id)) continue;

    const partner = db.profiles[partnerId];

    if (!partner || partner.cpPartnerId !== profile.id) {
      continue;
    }

    added.add(profile.id);
    added.add(partner.id);

    const xp = period === "monthly"
      ? profile.cpMonthlyXP
      : profile.cpWeeklyXP;

    pairs.push({
      userId: profile.id,
      partnerId: partner.id,
      name: profile.name,
      partnerName: partner.name,
      avatar: profile.avatar || "",
      partnerAvatar: partner.avatar || "",
      level: getCPLevel(profile.cpXP),
      xp
    });
  }

  pairs.sort((a, b) => b.xp - a.xp);

  reply(callback, {
    ok: true,
    period,
    ranking: pairs.slice(0, 50)
  });
});
   
  /* =======================================
     DISCONNECT
  ======================================= */

  socket.on("disconnect", () => {
    leaveRoom(socket);
    online.delete(socket.id);

    io.emit("online-count", online.size);
  });

});

/* =========================================
   START SERVER
========================================= */

server.listen(PORT, "0.0.0.0", () => {
  console.log("=================================");
  console.log("HUKA VOICE CHAT SERVER STARTED");
  console.log("Port:", PORT);
  console.log("Public folder:", PUBLIC_DIR);
  console.log("Gifts:", GIFTS.length);
  console.log("Frames:", FRAMES.length);
  console.log("=================================");
});
