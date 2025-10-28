// === app.js ===
// Serveur PeerToSend (Express + Socket.io + Twilio TURN)

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// === TWILIO TURN (STUN + TURN) ===
app.get("/ice-servers", async (req, res) => {
  try {
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      console.error("❌ Identifiants Twilio manquants");
      return res.status(500).json({ error: "Twilio credentials missing" });
    }

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Tokens.json`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const data = await response.json();
    if (data.ice_servers) {
      res.json(data.ice_servers);
    } else {
      console.error("⚠️ Réponse Twilio inattendue :", data);
      res.json([]);
    }
  } catch (err) {
    console.error("Erreur /ice-servers :", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// === Sessions ===
// Structure : { code: { sender: socket, fileInfo: {...}, receivers: Set<socket> } }
const sessions = {};

io.on("connection", (socket) => {
  console.log("🔗 Nouvelle connexion :", socket.id);

  // --- Création d’un code par le sender ---
  socket.on("create-code", (fileInfo, callback) => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Si un code existe déjà pour ce sender, on le garde
    sessions[code] = {
      sender: socket,
      fileInfo,
      receivers: new Set(),
    };

    console.log(`📦 Nouveau code créé : ${code} (${fileInfo.name})`);
    callback({ code });
  });

  // --- Rejoindre un code existant (receiver) ---
  socket.on("join-code", (code, callback) => {
    const session = sessions[code];
    if (!session) {
      console.log("❌ Code introuvable :", code);
      return callback({ ok: false });
    }

    session.receivers.add(socket);
    console.log(`✅ Nouveau receveur connecté au code ${code}`);

    callback({ ok: true, fileInfo: session.fileInfo });
    session.sender.emit("receiver-joined", code);
  });

  // --- Transmission de l'offre WebRTC ---
  socket.on("webrtc-offer", ({ code, desc }) => {
    const s = sessions[code];
    if (!s) return;
    for (const r of s.receivers) {
      r.emit("webrtc-offer", { desc });
    }
    console.log(`📨 Offre envoyée aux receveurs (${code})`);
  });

  // --- Transmission de la réponse WebRTC ---
  socket.on("webrtc-answer", ({ code, desc }) => {
    const s = sessions[code];
    if (!s) return;
    s.sender.emit("webrtc-answer", { desc });
    console.log(`📩 Réponse envoyée au sender (${code})`);
  });

  // --- Transmission des ICE candidates ---
  socket.on("webrtc-ice", ({ code, candidate }) => {
    const s = sessions[code];
    if (!s) return;

    if (socket === s.sender) {
      for (const r of s.receivers) {
        r.emit("webrtc-ice", { candidate });
      }
    } else {
      s.sender.emit("webrtc-ice", { candidate });
    }
  });

  // --- Déconnexion ---
  socket.on("disconnect", () => {
    for (const [code, s] of Object.entries(sessions)) {
      if (socket === s.sender) {
        // ⚠️ Supprime toute la session seulement si le sender quitte
        delete sessions[code];
        console.log(`❌ Session ${code} supprimée (sender déconnecté)`);
        break;
      } else if (s.receivers.has(socket)) {
        s.receivers.delete(socket);
        console.log(`👋 Receiver déconnecté du code ${code}`);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
