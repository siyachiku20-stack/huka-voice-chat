"use strict";

/* =========================================
   HUKA VOICE CHAT - HOME PAGE SCRIPT
   Purple + Pink Theme
========================================= */

const socket = io();

const getElement = (...selectors) => {
    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) return element;
    }
    return null;
};

const getStored = (...keys) => {
    for (const key of keys) {
        const value = localStorage.getItem(key);
        if (value) return value;
    }
    return "";
};

let currentUser = null;
let roomList = [];

/* =========================================
   USER PROFILE
========================================= */

function getUserName() {
    return getStored("hukaName", "hukaUsername", "username") || "Huka User";
}

function getUserId() {
    return getStored("hukaUserId", "userId");
}

function saveUser(user) {
    if (!user) return;

    currentUser = user;

    if (user.id) {
        localStorage.setItem("hukaUserId", user.id);
    }

    if (user.name) {
        localStorage.setItem("hukaName", user.name);
        localStorage.setItem("hukaUsername", user.name);
    }

    if (user.avatar) {
        localStorage.setItem("hukaAvatar", user.avatar);
    }

    localStorage.setItem("hukaProfile", JSON.stringify(user));

    updateProfileDisplay();
}

function updateProfileDisplay() {
    const name = currentUser?.name || getUserName();
    const avatar = currentUser?.avatar || getStored("hukaAvatar");

    document.querySelectorAll(
        "#username, #profileName, #userName, .profile-name, .username"
    ).forEach(element => {
        element.textContent = name;
    });

    document.querySelectorAll(
        "#profileAvatar, #userAvatar, .profile-avatar"
    ).forEach(element => {
        if (!avatar) return;

        if (element.tagName === "IMG") {
            element.src = avatar;
        } else {
            element.style.backgroundImage = `url("${avatar}")`;
        }
    });
}

function registerUser() {
    socket.emit("register", {
        userId: getUserId(),
        name: getUserName()
    }, response => {
        if (response?.ok && response.user) {
            saveUser(response.user);
        }
    });
}

/* =========================================
   SOCKET CONNECTION
========================================= */

socket.on("connect", () => {
    console.log("Huka connected:", socket.id);

    registerUser();

    setTimeout(loadRooms, 500);
});

socket.on("disconnect", () => {
    console.log("Huka disconnected");
});

socket.on("connect_error", error => {
    console.error("Connection error:", error.message);
});

/* =========================================
   LOAD ROOMS
========================================= */

function loadRooms() {
    if (!socket.connected) return;
    socket.emit("get-rooms");
}

socket.on("room-list", rooms => {
    if (!Array.isArray(rooms)) return;

    roomList = rooms;
    displayRooms(roomList);
});

/* =========================================
   DISPLAY ROOMS
========================================= */

function displayRooms(rooms) {
    const container = getElement(
        "#roomList",
        "#roomsList",
        "#roomsContainer",
        "#popularRooms",
        "#voiceRooms",
        ".room-list",
        ".rooms-list",
        ".rooms-container"
    );

    if (!container) {
        console.log("Room list container not found");
        return;
    }

    if (!rooms.length) {
        container.innerHTML = `
            <div class="empty-rooms">
                <h3>No Rooms Available</h3>
                <p>Create a new room and invite your friends.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = "";

    rooms.forEach(room => {
        const roomId = room.id || room.roomId;
        const roomName = room.name || "Huka Voice Room";
        const owner = room.ownerName || room.owner || "Room Owner";
        const seats = room.seatsCount || room.seatCount || 9;

        const members = Array.isArray(room.members)
            ? room.members.length
            : (room.memberCount || 0);

        const card = document.createElement("div");
        card.className = "room-card";

        card.innerHTML = `
            <div class="room-card-content">
                <div class="room-card-icon">🎙️</div>

                <div class="room-card-info">
                    <h3>${escapeHTML(roomName)}</h3>
                    <p>👑 ${escapeHTML(String(owner))}</p>
                    <p>👥 ${members} Members</p>
                    <p>🪑 ${seats} Seats</p>
                </div>

                <button class="join-room-button" type="button">
                    Join
                </button>
            </div>
        `;

        card.querySelector("button").addEventListener("click", () => {
            joinRoom(roomId);
        });

        container.appendChild(card);
    });
}

/* =========================================
   HTML SAFETY
========================================= */

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => {
        const replacements = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        };

        return replacements[character];
    });
}

/* =========================================
   CREATE ROOM
========================================= */

function createRoom() {
    const nameInput = getElement(
        "#roomName",
        "#createRoomName",
        "#newRoomName",
        'input[name="roomName"]'
    );

    const seatsInput = getElement(
        "#roomSeats",
        "#seatCount",
        "#createRoomSeats",
        'select[name="seats"]'
    );

    const roomName = nameInput?.value.trim() || "Huka Voice Room";
    const seats = Number(seatsInput?.value || 9);

    if (![9, 11, 15, 20].includes(seats)) {
        alert("Please select 9, 11, 15 or 20 seats.");
        return;
    }

    socket.emit("create-room", {
        name: roomName,
        seats: seats
    }, response => {
        if (!response || !response.ok) {
            alert(response?.message || "Room create nahi hua.");
            return;
        }

        const roomId = response.id || response.roomId;

        if (!roomId) {
            alert("Room ID nahi mila.");
            return;
        }

        localStorage.setItem("hukaRoomId", roomId);

        window.location.href =
            "room.html?room=" + encodeURIComponent(roomId);
    });
}

/* =========================================
   JOIN ROOM
========================================= */

function joinRoom(roomId) {
    if (!roomId) {
        alert("Invalid Room ID");
        return;
    }

    localStorage.setItem("hukaRoomId", roomId);

    window.location.href =
        "room.html?room=" + encodeURIComponent(roomId);
}

/* =========================================
   JOIN ROOM USING ID
========================================= */

function joinRoomById() {
    const input = getElement(
        "#joinRoomId",
        "#roomIdInput",
        "#roomCode",
        'input[name="roomId"]'
    );

    const roomId = input?.value.trim();

    if (!roomId) {
        alert("Please enter Room ID.");
        return;
    }

    joinRoom(roomId);
}

/* =========================================
   BUTTON CONNECTIONS
========================================= */

function setupButtons() {
    document.querySelectorAll(
        "#createRoomBtn, #createRoomButton, .create-room-btn, [data-action='create-room']"
    ).forEach(button => {
        button.addEventListener("click", createRoom);
    });

    document.querySelectorAll(
        "#joinRoomBtn, #joinRoomButton, .join-room-btn, [data-action='join-room']"
    ).forEach(button => {
        button.addEventListener("click", joinRoomById);
    });

    document.querySelectorAll(
        "#refreshRooms, #refreshRoomsBtn, .refresh-rooms"
    ).forEach(button => {
        button.addEventListener("click", loadRooms);
    });
}

/* =========================================
   NAVIGATION
========================================= */

function setupNavigation() {
    document.querySelectorAll(
        "#profileBtn, #profileNav, [data-page='profile']"
    ).forEach(button => {
        button.addEventListener("click", () => {
            window.location.href = "profile.html";
        });
    });

    document.querySelectorAll(
        "#homeBtn, #homeNav, [data-page='home']"
    ).forEach(button => {
        button.addEventListener("click", () => {
            window.location.href = "index.html";
        });
    });
}

/* =========================================
   COUNTRY FILTER
========================================= */

function setupCountryFilter() {
    const countryFilter = getElement(
        "#countryFilter",
        "#countrySelect",
        "#country"
    );

    if (!countryFilter) return;

    countryFilter.addEventListener("change", () => {
        const selectedCountry = countryFilter.value;

        if (!selectedCountry || selectedCountry === "all") {
            displayRooms(roomList);
            return;
        }

        const filteredRooms = roomList.filter(room => {
            return room.country === selectedCountry;
        });

        displayRooms(filteredRooms);
    });
}

/* =========================================
   SEARCH ROOMS
========================================= */

function setupRoomSearch() {
    const searchInput = getElement(
        "#roomSearch",
        "#searchRoom",
        "#searchInput"
    );

    if (!searchInput) return;

    searchInput.addEventListener("input", () => {
        const query = searchInput.value.toLowerCase().trim();

        const filteredRooms = roomList.filter(room => {
            const name = (room.name || "").toLowerCase();
            const id = String(room.id || room.roomId || "");

            return name.includes(query) || id.includes(query);
        });

        displayRooms(filteredRooms);
    });
}

/* =========================================
   LOAD SAVED PROFILE
========================================= */

function loadSavedProfile() {
    try {
        const saved = localStorage.getItem("hukaProfile");

        if (saved) {
            currentUser = JSON.parse(saved);
        }
    } catch (error) {
        console.error("Profile loading error:", error);
    }

    updateProfileDisplay();
}

/* =========================================
   START APP
========================================= */

document.addEventListener("DOMContentLoaded", () => {
    loadSavedProfile();
    setupButtons();
    setupNavigation();
    setupCountryFilter();
    setupRoomSearch();

    console.log("Huka Voice Chat Home Loaded");
});

/* =========================================
   AUTO REFRESH ROOMS
========================================= */

setInterval(() => {
    if (socket.connected) {
        loadRooms();
    }
}, 15000);
