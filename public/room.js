// =====================================
// HUKA VOICE CHAT - ROOM SYSTEM
// =====================================

const socket = typeof io !== "undefined" ? io() : null;

let myCoins = 10000;
let micOn = false;
let speakerOn = true;
let currentSeats = 9;
let currentCategory = "All";

const myUsername = localStorage.getItem("hukaUsername") || "Huka";
const roomId = new URLSearchParams(location.search).get("room") || "100011";

const seatUsers = {};
const giftRanking = {};
const gifts = [];

// =====================================
// 251 GIFTS SYSTEM
// =====================================

const giftCategories = {
Customization: ["👑","💎","🌈","🦋","🌸","✨","🎀","💫","🪄","💖"],
Lucky: ["🍀","🐉","🧧","🎲","🌟","🪙","🌻","🐞","🎁","🔮"],
VIP: ["🏆","🚘","🛥️","💍","👸","🤴","🏰","💎","🦚","🌹"],
Love: ["❤️","💘","💝","💞","💗","💕","💓","🌹","🥰","💌"],
Royal: ["👑","🏰","🐎","🦁","⚜️","💠","💍","🛡️","🦚","🏆"],
Premium: ["🚀","🌌","🌠","🎇","🎆","🪐","🌙","☀️","💫","🎊"],
Popular: ["🔥","🎂","🍫","🍓","🎵","🎤","🎧","🐼","🐱","🐰"],
Special: ["🦄","🐬","🦋","🐯","🦊","🐻","🐨","🐸","🦜","🦩"],
Festival: ["🎄","🎃","🎅","🎉","🪔","🎊","🎆","🎇","🪅","🎈"],
Exclusive: ["💎","👑","🚁","✈️","🏎️","🌋","🌊","🛸","🦄","🌟"]
};

const categoryPrices = {
Customization: 100,
Lucky: 200,
VIP: 500,
Love: 50,
Royal: 1000,
Premium: 1500,
Popular: 80,
Special: 300,
Festival: 250,
Exclusive: 2500
};

function createGifts() {
const categories = Object.keys(giftCategories);

```
for (let i = 1; i <= 251; i++) {
    const category = categories[(i - 1) % categories.length];
    const icons = giftCategories[category];
    const icon = icons[Math.floor((i - 1) / categories.length) % icons.length];

    gifts.push({
        id: i,
        name: category + " Gift " + i,
        category,
        icon,
        price: categoryPrices[category] + (i % 10) * 10
    });
}
```

}

createGifts();

// =====================================
// ROOM INITIALIZATION
// =====================================

document.getElementById("roomId").textContent = roomId;

function updateCoins() {
document.getElementById("myCoins").textContent = myCoins.toLocaleString();
}

updateCoins();

// =====================================
// SEAT SYSTEM
// =====================================

function changeSeats() {
const count = Number(document.getElementById("seatCount").value);

```
if (![9, 11, 15, 20].includes(count)) return;

currentSeats = count;
renderSeats();

if (socket) {
    socket.emit("changeSeats", {
        roomId,
        count
    });
}
```

}

function renderSeats() {
const container = document.getElementById("seats");
container.innerHTML = "";

```
for (let i = 1; i <= currentSeats; i++) {
    const user = seatUsers[i];

    const seat = document.createElement("div");
    seat.className = "seat";

    seat.innerHTML = `
        <div class="avatar">${user ? "👤" : "🎙️"}</div>
        <strong>${user || "Empty Seat"}</strong>
        <small>Seat ${i}</small>
        <button onclick="joinSeat(${i})">
            ${user ? "Occupied" : "Join"}
        </button>
    `;

    container.appendChild(seat);
}
```

}

function joinSeat(number) {
if (seatUsers[number]) {
alert("This seat is occupied!");
return;
}

```
seatUsers[number] = myUsername;
renderSeats();

if (socket) {
    socket.emit("joinSeat", {
        roomId,
        seat: number,
        username: myUsername
    });
}
```

}

renderSeats();

// =====================================
// MIC SYSTEM
// =====================================

function toggleMic() {
micOn = !micOn;

```
document.getElementById("micButton").textContent =
    micOn ? "🔴" : "🎙️";

if (socket) {
    socket.emit("toggleMic", {
        roomId,
        username: myUsername,
        micOn
    });
}

alert(micOn ? "Mic ON" : "Mic OFF");
```

}

// =====================================
// SPEAKER SYSTEM
// =====================================

function toggleSpeaker() {
speakerOn = !speakerOn;

```
const button = event.currentTarget;
button.textContent = speakerOn ? "🔊" : "🔇";
```

}

// =====================================
// GIFT PANEL
// =====================================

function openGifts() {
closePanels();
document.getElementById("giftPanel").style.display = "block";
showGifts("All");
}

function showGifts(category) {
currentCategory = category;

```
const container = document.getElementById("giftList");
container.innerHTML = "";

const filtered = category === "All"
    ? gifts
    : gifts.filter(g => g.category === category);

filtered.forEach(gift => {
    const item = document.createElement("div");
    item.className = "gift-item";

    item.innerHTML = `
        <div class="gift-icon">${gift.icon}</div>
        <strong>${gift.name}</strong>
        <small>💰 ${gift.price} Coins</small>
        <button onclick="sendGift(${gift.id})">Send</button>
    `;

    container.appendChild(item);
});
```

}

// =====================================
// SEND GIFT
// =====================================

function sendGift(id) {
const gift = gifts.find(g => g.id === id);

```
if (!gift) return;

if (myCoins < gift.price) {
    alert("Not enough coins!");
    return;
}

myCoins -= gift.price;
updateCoins();

giftRanking[myUsername] =
    (giftRanking[myUsername] || 0) + gift.price;

showLiveGift(gift);
renderGiftRanking();

if (socket) {
    socket.emit("sendGift", {
        roomId,
        gift,
        username: myUsername
    });
}
```

}

function showLiveGift(gift) {
const area = document.getElementById("liveEffects");

```
const effect = document.createElement("div");

effect.innerHTML = `
    <div style="font-size:40px">${gift.icon}</div>
    <strong>${myUsername} sent ${gift.name}!</strong>
`;

area.appendChild(effect);

setTimeout(() => effect.remove(), 4000);
```

}

// =====================================
// GIFT RANKING
// =====================================

function renderGiftRanking() {
const container = document.getElementById("giftRanking");

```
const ranking = Object.entries(giftRanking)
    .sort((a, b) => b[1] - a[1]);

container.innerHTML = "";

ranking.forEach(([username, coins], index) => {
    const row = document.createElement("p");

    row.textContent =
        `${index + 1}. ${username} - ${coins} Coins`;

    container.appendChild(row);
});
```

}

// =====================================
// EMOJI SYSTEM
// =====================================

function openEmoji() {
closePanels();
document.getElementById("emojiPanel").style.display = "block";
}

function sendEmoji(emoji) {
showLiveEmoji(emoji);

```
if (socket) {
    socket.emit("sendEmoji", {
        roomId,
        username: myUsername,
        emoji
    });
}

closePanels();
```

}

function showLiveEmoji(emoji) {
const area = document.getElementById("liveEffects");
const item = document.createElement("div");

```
item.textContent = emoji;
item.style.fontSize = "35px";

area.appendChild(item);

setTimeout(() => item.remove(), 3000);
```

}

// =====================================
// MENTION SYSTEM
// =====================================

function mentionUser() {
closePanels();

```
const panel = document.getElementById("mentionPanel");
const container = document.getElementById("mentionUsers");

container.innerHTML = "";

Object.values(seatUsers).forEach(username => {
    const button = document.createElement("button");

    button.textContent = "@" + username;

    button.onclick = () => {
        const message = prompt(
            "Message for @" + username
        );

        if (message) {
            addChatMessage(myUsername, "@" + username + " " + message);
        }

        closePanels();
    };

    container.appendChild(button);
});

panel.style.display = "block";
```

}

// =====================================
// CHAT SYSTEM
// =====================================

function addChatMessage(username, message) {
const container = document.getElementById("chatMessages");

```
const item = document.createElement("div");
item.className = "chat-message";

const name = document.createElement("strong");
name.textContent = username + ": ";

const text = document.createElement("span");
text.textContent = message;

item.appendChild(name);
item.appendChild(text);

container.appendChild(item);
container.scrollTop = container.scrollHeight;
```

}

function clearChat() {
if (!confirm("Delete all visible chat messages?")) return;

```
document.getElementById("chatMessages").innerHTML = "";

if (socket) {
    socket.emit("clearChat", { roomId });
}

closePanels();
```

}

// =====================================
// INBOX
// =====================================

function openInbox() {
closePanels();

```
document.getElementById("inboxPanel").style.display = "block";
```

}

// =====================================
// MORE MENU
// =====================================

function openMore() {
closePanels();

```
document.getElementById("morePanel").style.display = "block";
```

}

function openRoomSettings() {
closePanels();

```
document.getElementById("settingsPanel").style.display = "block";
```

}

function saveRoomSettings() {
const name = document.getElementById("newRoomName").value.trim();
const announcement = document.getElementById("newAnnouncement").value.trim();

```
if (name) {
    document.getElementById("roomName").textContent = name;
}

if (announcement) {
    document.getElementById("announcement").textContent = announcement;
}

if (socket) {
    socket.emit("updateRoom", {
        roomId,
        name,
        announcement
    });
}

closePanels();
alert("Room settings updated!");
```

}

// =====================================
// YOUTUBE PLAYER
// =====================================

function openYouTube() {
closePanels();

```
document.getElementById("videoArea").style.display = "block";
```

}

function playYouTube() {
const link = document.getElementById("youtubeLink").value.trim();

```
let videoId = "";

try {
    const url = new URL(link);

    if (url.hostname.includes("youtu.be")) {
        videoId = url.pathname.substring(1);
    } else {
        videoId = url.searchParams.get("v") || "";
    }
} catch {
    alert("Please enter a valid YouTube link.");
    return;
}

if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    alert("Invalid YouTube video link.");
    return;
}

document.getElementById("youtubePlayer").innerHTML = `
    <iframe
        src="https://www.youtube.com/embed/${videoId}"
        allowfullscreen
        allow="autoplay; encrypted-media; picture-in-picture">
    </iframe>
`;

if (socket) {
    socket.emit("youtubePlay", {
        roomId,
        videoId
    });
}
```

}

// =====================================
// MP3 MUSIC PLAYER
// =====================================

function openMusic() {
closePanels();

```
document.getElementById("mp3File").click();
```

}

document.getElementById("mp3File").addEventListener("change", function() {
const file = this.files[0];

```
if (!file) return;

if (!file.type.startsWith("audio/")) {
    alert("Please select an audio file.");
    return;
}

const url = URL.createObjectURL(file);

const player = document.getElementById("musicPlayer");

player.src = url;
player.play();

document.querySelector(".music-area").style.display = "block";
```

});

// =====================================
// RANKING
// =====================================

function showRanking() {
closePanels();

```
document.querySelector(".gift-ranking").scrollIntoView({
    behavior: "smooth"
});
```

}

// =====================================
// CLOSE PANELS
// =====================================

function closePanels() {
document.querySelectorAll(".panel").forEach(panel => {
panel.style.display = "none";
});
}

// =====================================
// EXIT ROOM
// =====================================

function exitRoom() {
if (!confirm("Are you sure you want to leave this room?")) {
return;
}

```
if (socket) {
    socket.emit("leaveRoom", {
        roomId,
        username: myUsername
    });
}

location.href = "index.html";
```

}

// =====================================
// SOCKET EVENTS
// =====================================

if (socket) {
socket.on("receiveGift", data => {
showLiveGift(data.gift);
});

```
socket.on("receiveEmoji", data => {
    showLiveEmoji(data.emoji);
});

socket.on("chatMessage", data => {
    addChatMessage(data.username, data.message);
});

socket.on("members", members => {
    document.getElementById("onlineCount").textContent =
        Array.isArray(members) ? members.length : 0;
});
```

}

console.log("Huka Voice Chat Room Loaded!");
console.log("Total Gifts:", gifts.length);
