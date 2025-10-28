const socket = io();

const fileInput = document.getElementById("fileInput");
const createBtn = document.getElementById("createBtn");
const senderStatus = document.getElementById("senderStatus");
const generatedCode = document.getElementById("generatedCode");
const copyCodeBtn = document.getElementById("copyCodeBtn");
const receiversList = document.getElementById("receiversList");

let file, fileBuffer, currentCode;

// récupérer les serveurs Twilio
async function getIceServers() {
  const res = await fetch("/ice-servers");
  const data = await res.json();
  console.log("🎫 Serveurs ICE Twilio :", data);
  return data;
}

function log(txt) {
  senderStatus.textContent = "Statut : " + txt;
  console.log("📤", txt);
}

createBtn.onclick = async () => {
  file = fileInput.files[0];
  if (!file) return alert("Choisis un fichier !");
  fileBuffer = await file.arrayBuffer();

  socket.emit("create-code", { name: file.name, size: file.size }, ({ code }) => {
    currentCode = code;
    generatedCode.textContent = code;
    log("Code créé : " + code);
  });
};

copyCodeBtn.onclick = () => {
  if (currentCode) {
    navigator.clipboard.writeText(currentCode);
    alert("Code copié !");
  }
};

socket.on("receiver-joined", async (code) => {
  if (code !== currentCode) return;
  log("Receveur détecté !");
  const li = document.createElement("li");
  li.textContent = "Connexion en cours...";
  receiversList.appendChild(li);

  const ice = await getIceServers();
  const pc = new RTCPeerConnection({
    iceServers: ice,
    iceTransportPolicy: "relay"
  });

  const dc = pc.createDataChannel("file");
  dc.binaryType = "arraybuffer";

  dc.onopen = async () => {
    console.log("✅ Canal ouvert !");
    li.textContent = "Envoi du fichier...";
    const chunkSize = 64 * 1024;
    let offset = 0;
    while (offset < fileBuffer.byteLength) {
      const slice = fileBuffer.slice(offset, offset + chunkSize);
      dc.send(slice);
      offset += chunkSize;
      await new Promise((r) => setTimeout(r, 2));
    }
    dc.send(JSON.stringify({ done: true, name: file.name }));
    li.textContent = `✅ Fichier envoyé (${file.name})`;
    log("Fichier envoyé !");
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit("webrtc-ice", { code, candidate: e.candidate });
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("webrtc-offer", { code, desc: offer });

  socket.on("webrtc-answer", async ({ desc }) => {
    if (desc) await pc.setRemoteDescription(new RTCSessionDescription(desc));
  });

  socket.on("webrtc-ice", async ({ candidate }) => {
    if (candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate));
  });
});
