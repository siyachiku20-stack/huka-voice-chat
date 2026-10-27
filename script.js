const socket = typeof io === "function" ? io() : null;

const pages = document.querySelectorAll(
"main > section.page"
);

let username = "";
let currentRoom = "";

function showPage(pageId) {
pages.forEach((page) => {
page.classList.toggle("hidden", page.id !== pageId);
});
}

function addChatMessage(data) {
const list = document.getElementById("chatMessages");
const row = document.createElement("p");
const name = document.createElement("strong");
const message = document.createElement("span");

name.textContent = (data.username || "Guest") + ": ";
message.textContent = data.message || "";

row.append(name, message);
list.appendChild(row);
list.scrollTop = list.scrollHeight;
}

document.querySelectorAll("[data-page]").forEach((button) => {
button.addEventListener("click", () => {
showPage(button.dataset.page);
});
});

document.querySelectorAll("[data-room]").forEach((button) => {
button.addEventListener("click", () => {
username = prompt("Apna naam likho (2-24 characters):");

```
if (!username) return;

username = username.trim().slice(0, 24);

if (username.length < 2) {
  alert("Naam kam se kam 2 characters ka hona chahiye.");
  return;
}

currentRoom = button.dataset.room;

document.getElementById("roomTitle").textContent = currentRoom;
document.getElementById("myName").textContent = username;
document.getElementById("profileName").textContent = username;
document.getElementById("members").replaceChildren();
document.getElementById("chatMessages").replaceChildren();

showPage("roomPage");

if (socket) {
  socket.emit("joinRoom", {
    room: currentRoom,
    username
  });
} else {
  alert("Live server abhi connect nahi hai.");
}
```

});
});

if (socket) {
socket.on("joined", (room) => {
document.getElementById("roomTitle").textContent = room;
});

socket.on("members", (members) => {
const list = document.getElementById("members");
list.replaceChildren();

```
members.forEach((member) => {
  const item = document.createElement("li");
  item.textContent = member;
  list.appendChild(item);
});
```

});

socket.on("chatMessage", addChatMessage);
}

document.getElementById("chatForm").addEventListener("submit", (event) => {
event.preventDefault();

const input = document.getElementById("chatInput");
const message = input.value.trim();

if (!message || !socket || !currentRoom) return;

socket.emit("chatMessage", message);
input.value = "";
});

function leaveRoom() {
if (socket && currentRoom) {
socket.emit("leaveRoom");
}

currentRoom = "";
showPage("home");
}

document.getElementById("backButton").addEventListener("click", leaveRoom);
document.getElementById("leaveButton").addEventListener("click", leaveRoom);
