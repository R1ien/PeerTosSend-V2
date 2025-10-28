const socket = io();

const codeInput = document.getElementById("codeInput");
const joinBtn = document.getElementById("joinBtn");
const receiverStatus = document.getElementById("receiverStatus");
const downloadArea = document.getElementById("downloadArea");
const helpText = document.getElementById("helpText");

let pc, dataChannel;
let receiveBuffer = [];
let totalBytes = 0;
let fileInfo = null;
let currentCode = null;
let offerPending = null;

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " Ko";
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " Mo";
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + " Go";
}

function updateStatus(msg) {
  receiverStatus.textContent = msg;
  console.log("📥", msg);
}

async function getIceServers() {
  try {
    const res = await fetch("/ice-servers");
    const data = await res.json();
    return data;
  } catch {
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}

joinBtn.onclick = () => {
  const code = codeInput.value.trim();
  if (!/^\d{6}$/.test(code)) return alert("Code invalide !");
  currentCode = code;
  updateStatus("Connexion au serveur...");
  socket.emit("join-code", code, (res) => {
    if (!res.ok) return updateStatus("❌ Code introuvable !");
    fileInfo = res.fileInfo;
    const sizeText = formatSize(fileInfo.size);
    updateStatus(`Fichier trouvé : ${fileInfo.name} — ${sizeText}`);
    downloadArea.innerHTML = `<button id="startBtn">📥 Télécharger</button>`;
    document.getElementById("startBtn").onclick = startDownload;
  });
};

async function startDownload() {
  const code = currentCode || codeInput.value.trim();
  if (!/^\d{6}$/.test(code)) return alert("Code invalide !");
  if (!fileInfo) {
    updateStatus("Recherche du fichier...");
    joinSession(code, startDownload);
    return;
  }

  if (!offerPending) {
    const sizeText = formatSize(fileInfo.size);
    updateStatus(`Fichier : ${fileInfo.name} — ${sizeText}`);
    return;
  }

  const sizeText = formatSize(fileInfo.size);
  updateStatus(`Fichier : ${fileInfo.name} — ${sizeText} — Téléchargement en cours...`);
  downloadArea.innerHTML = "<p>⏳ Téléchargement en cours...</p>";

  const ice = await getIceServers();
  pc = new RTCPeerConnection({
    iceServers: ice,
    iceTransportPolicy: "relay"
  });

  pc.ondatachannel = (e) => {
    dataChannel = e.channel;
    dataChannel.binaryType = "arraybuffer";
    dataChannel.onopen = () =>
      updateStatus(`Fichier : ${fileInfo.name} — ${sizeText} — Téléchargement en cours...`);
    dataChannel.onmessage = onData;
  };

  pc.onicecandidate = (e) => {
    if (e.candidate)
      socket.emit("webrtc-ice", { code: code, candidate: e.candidate });
  };

  await pc.setRemoteDescription(new RTCSessionDescription(offerPending));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("webrtc-answer", { code: code, desc: answer });
  offerPending = null;
}

socket.on("webrtc-offer", async ({ desc }) => {
  offerPending = desc;
});

socket.on("webrtc-ice", async ({ candidate }) => {
  if (!pc) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error("Erreur addIceCandidate:", err);
  }
});

function onData(e) {
  if (typeof e.data === "string") {
    try {
      const msg = JSON.parse(e.data);
      if (msg.done) {
        const blob = new Blob(receiveBuffer);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = msg.name;
        a.click();
        const sizeText = formatSize(fileInfo.size);
        updateStatus(`✅ Téléchargement terminé : ${msg.name} — ${sizeText}`);
        receiveBuffer = [];
        totalBytes = 0;
        return;
      }
    } catch {}
  } else {
    receiveBuffer.push(e.data);
    totalBytes += e.data.byteLength;
    const percent = Math.floor((totalBytes / fileInfo.size) * 100);
    const sizeText = formatSize(fileInfo.size);
    updateStatus(`Fichier : ${fileInfo.name} — ${sizeText} — ${percent}%`);
  }
}
