const socket = io();

let currentRoom = "";
let username = "";

function showPage(pageId) {
document.querySelectorAll(".page").forEach((page) => {
page.classList.remove("active");
});

document.getElementById(pageId).classList.add("active");
}

function joinRoom(room) {
if (!username) {
const enteredName = prompt("Apna naam likho:");

```
if (!enteredName || !enteredName.trim()) {
  alert("Room join karne ke liye naam likhna zaroori hai.");
  return;
}

username = enteredName.trim().slice(0, 20);
```

}

if (currentRoom) {
socket.emit("leaveRoom");
}

currentRoom = room;

document.getElementById("roomTitle").textContent = "🎙️ " + room;
document.getElementById("messages").replaceChildren();
document.getElementById("members").replaceChildren();

socket.emit("joinRoom", { room, username });
showPage("chat");
}

function leaveRoom() {
if (currentRoom) {
socket.emit("leaveRoom");
currentRoom = "";
}

document.getElementById("members").replaceChildren();
showPage("rooms");
}

socket.on("members", (members) => {
const list = document.getElementById("members");
list.replaceChildren();

members.forEach((name) => {
const item = document.createElement("li");
item.textContent = "👤 " + name;
list.appendChild(item);
});

document.getElementById("memberCount").textContent = members.length;
});

socket.on("chatMessage", (data) => {
const messages = document.getElementById("messages");
const item = document.createElement("div");
item.className = "message";

const name = document.createElement("strong");
name.textContent = data.username + ": ";

const message = document.createElement("span");
message.textContent = data.message;

item.append(name, message);
messages.appendChild(item);
messages.scrollTop = messages.scrollHeight;
});

document.getElementById("chatForm").addEventListener("submit", (event) => {
event.preventDefault();

const input = document.getElementById("messageInput");
const message = input.value.trim();

if (message && currentRoom) {
socket.emit("chatMessage", message);
input.value = "";
}
});
