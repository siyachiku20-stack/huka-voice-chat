const socket = io();

let profile = null;
let currentRoom = null;
let localStream = null;

const peers = new Map();

const $ = (id) => document.getElementById(id);


// Load saved profile
const savedProfile = localStorage.getItem("hukaProfile");

if (savedProfile) {
    try {
        profile = JSON.parse(savedProfile);
        showDashboard();
    } catch {
        localStorage.removeItem("hukaProfile");
    }
}


// Create Profile
$("createProfile").onclick = async () => {

    const username = $("username").value.trim();

    $("loginError").textContent = "";

    if (username.length < 2) {
        $("loginError").textContent =
            "Enter at least 2 characters.";
        return;
    }

    try {

        const response = await fetch("/api/profile", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ username })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error);
        }

        profile = data.profile;

        localStorage.setItem(
            "hukaProfile",
            JSON.stringify(profile)
        );

        showDashboard();

    } catch (error) {

        $("loginError").textContent = error.message;

    }
};


// Dashboard
function showDashboard() {

    $("loginSection").hidden = true;
    $("dashboard").hidden = false;

    $("displayName").textContent = profile.username;

    $("profileId").textContent = profile.profileId;

    $("myRoomId").textContent = profile.roomId;

    $("roomInput").value = profile.roomId;
}


// Join Room
$("joinRoom").onclick = () => {

    const roomId = $("roomInput").value.trim();

    $("roomError").textContent = "";

    if (!/^\d{6,12}$/.test(roomId)) {
        $("roomError").textContent = "Invalid Room ID.";
        return;
    }

    socket.emit("joinRoom", {
        profileId: profile.profileId,
        username: profile.username,
        roomId
    }, (result) => {

        if (!result || !result.success) {
            $("roomError").textContent =
                result?.error || "Could not join room.";
            return;
        }

        currentRoom = roomId;

        $("currentRoom").textContent = roomId;

        $("roomSection").hidden = false;

        $("messages").innerHTML = "";

        $("voiceStatus").textContent =
            "Voice disconnected";

    });
};


// Members
socket.on("members", (members) => {

    $("members").innerHTML = "";

    members.forEach(member => {

        const div = document.createElement("div");

        div.className = "member";

        const name = document.createElement("span");
        name.textContent = member.username;

        const status = document.createElement("span");
        status.textContent = member.inVoice
            ? "🎙️ Voice"
            : "Online";

        div.append(name, status);

        $("members").appendChild(div);

    });

});


// Chat messages
socket.on("chatMessage", (data) => {

    const div = document.createElement("div");

    div.className = "message";

    const name = document.createElement("strong");
    name.textContent = data.username;

    const message = document.createElement("div");
    message.textContent = data.message;

    const time = document.createElement("small");

    time.textContent = new Date(data.time)
        .toLocaleTimeString();

    div.append(name, message, time);

    $("messages").appendChild(div);

    $("messages").scrollTop =
        $("messages").scrollHeight;

});


// Send message
function sendChatMessage() {

    const input = $("messageInput");

    const message = input.value.trim();

    if (!message || !currentRoom) return;

    socket.emit("sendMessage", message);

    input.value = "";
}

$("sendMessage").onclick = sendChatMessage;

$("messageInput").addEventListener("keydown", (event) => {

    if (event.key === "Enter") {
        sendChatMessage();
    }

});


// Gifts
document.querySelectorAll("[data-gift]").forEach(button => {

    button.onclick = () => {

        if (!currentRoom) return;

        socket.emit(
            "sendGift",
            button.dataset.gift
        );

    };

});

socket.on("giftReceived", (data) => {

    const div = document.createElement("div");

    div.className = "message";

    div.textContent =
        data.username + " sent a gift: " + data.gift;

    $("messages").appendChild(div);

});


// Voice chat
$("voiceButton").onclick = async () => {

    if (localStream) {
        stopVoice();
        return;
    }

    try {

        localStream =
            await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false
            });

        socket.emit("voice:join");

        $("voiceButton").textContent = "🔴 Leave Voice";

        $("voiceStatus").textContent =
            "Microphone connected";

    } catch (error) {

        $("voiceStatus").textContent =
            "Microphone permission unavailable.";

    }

};


// WebRTC configuration
const rtcConfig = {
    iceServers: [
        {
            urls: "stun:stun.l.google.com:19302"
        }
    ]
};


function createPeer(targetId) {

    if (peers.has(targetId)) {
        return peers.get(targetId);
    }

    const peer = new RTCPeerConnection(rtcConfig);

    peers.set(targetId, peer);

    localStream.getTracks().forEach(track => {
        peer.addTrack(track, localStream);
    });

    peer.onicecandidate = (event) => {

        if (event.candidate) {

            socket.emit("voice:signal", {
                target: targetId,
                signal: {
                    candidate: event.candidate
                }
            });

        }

    };

    peer.ontrack = (event) => {

        let audio = document.getElementById(
            "audio-" + targetId
        );

        if (!audio) {

            audio = document.createElement("audio");

            audio.id = "audio-" + targetId;
            audio.autoplay = true;
            audio.playsInline = true;

            document.body.appendChild(audio);

        }

        audio.srcObject = event.streams[0];

        audio.play().catch(() => {});

    };

    peer.onconnectionstatechange = () => {

        if (
            peer.connectionState === "failed" ||
            peer.connectionState === "closed"
        ) {
            closePeer(targetId);
        }

    };

    return peer;
}


// Existing voice members
socket.on("voice:peer-list", async (members) => {

    if (!localStream) return;

    for (const member of members) {

        try {

            const peer = createPeer(member.socketId);

            const offer = await peer.createOffer();

            await peer.setLocalDescription(offer);

            socket.emit("voice:signal", {
                target: member.socketId,
                signal: {
                    description: peer.localDescription
                }
            });

        } catch (error) {

            console.error("Voice connection error:", error);

        }

    }

});


// Receive voice signals
socket.on("voice:signal", async (data) => {

    if (!localStream) return;

    try {

        const peer = createPeer(data.sender);

        const signal = data.signal;

        if (signal.description) {

            const description = signal.description;

            await peer.setRemoteDescription(description);

            if (description.type === "offer") {

                const answer = await peer.createAnswer();

                await peer.setLocalDescription(answer);

                socket.emit("voice:signal", {
                    target: data.sender,
                    signal: {
                        description: peer.localDescription
                    }
                });

            }

        }

        if (signal.candidate) {

            await peer.addIceCandidate(
                signal.candidate
            );

        }

    } catch (error) {

        console.error("Signal error:", error);

    }

});


// Remove peer
function closePeer(id) {

    const peer = peers.get(id);

    if (peer) {
        peer.close();
        peers.delete(id);
    }

    const audio = document.getElementById("audio-" + id);

    if (audio) {
        audio.srcObject = null;
        audio.remove();
    }

}


// Other member left voice
socket.on("voice:peer-left", (id) => {

    closePeer(id);

});


// Stop microphone
function stopVoice() {

    socket.emit("voice:leave");

    if (localStream) {

        localStream.getTracks().forEach(track => {
            track.stop();
        });

        localStream = null;

    }

    peers.forEach((peer, id) => {
        closePeer(id);
    });

    $("voiceButton").textContent = "🎙️ Join Voice";

    $("voiceStatus").textContent =
        "Voice disconnected";

}


// Leave room
$("leaveRoom").onclick = () => {

    stopVoice();

    socket.emit("leaveRoom");

    currentRoom = null;

    $("roomSection").hidden = true;

    $("messages").innerHTML = "";

};


// Connection status
socket.on("connect", () => {
    console.log("Connected to Huka server");
});

socket.on("disconnect", () => {
    stopVoice();

    $("voiceStatus").textContent =
        "Server disconnected";
});
