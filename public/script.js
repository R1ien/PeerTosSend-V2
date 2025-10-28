// Connexion Socket.IO
const socket = io();

// UI elements
const fileInput = document.getElementById('fileInput');
const createBtn = document.getElementById('createBtn');
const generatedCodeEl = document.getElementById('generatedCode');
const copyCodeBtn = document.getElementById('copyCodeBtn');
const senderStatus = document.getElementById('senderStatus');
const sendProgress = document.getElementById('sendProgress');

const codeInput = document.getElementById('codeInput');
const joinBtn = document.getElementById('joinBtn');
const receiverStatus = document.getElementById('receiverStatus');
const recvProgress = document.getElementById('recvProgress');
const downloadArea = document.getElementById('downloadArea');

// WebRTC config
let pc = null;
let dataChannel = null;
let fileToSend = null;
let receiveBuffer = [];
let receivedBytes = 0;
const CHUNK_SIZE = 64 * 1024;

const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// Helpers
function logSender(msg){ senderStatus.textContent = 'Statut: ' + msg; }
function logReceiver(msg){ receiverStatus.textContent = 'Statut: ' + msg; }

createBtn.onclick = () => {
  if (!fileInput.files.length) return alert('Choisis un fichier d\'abord !');
  fileToSend = fileInput.files[0];

  const meta = { name: fileToSend.name, size: fileToSend.size };
  socket.emit('create-code', meta, res => {
    if (!res || !res.code) return alert('Erreur serveur');
    generatedCodeEl.textContent = res.code;
    logSender('Code créé — attente du receveur');
    prepareSender(res.code);
  });
};

copyCodeBtn.onclick = () => {
  navigator.clipboard.writeText(generatedCodeEl.textContent);
  alert('Code copié !');
};

joinBtn.onclick = () => {
  const code = codeInput.value.trim();
  if (!/^\d{6}$/.test(code)) return alert('Code invalide');
  socket.emit('join-code', code, res => {
    if (!res || res.ok === false) return alert('Code introuvable');
    logReceiver('Connexion en cours...');
    prepareReceiver(code);
  });
};

// Sender setup
async function prepareSender(code){
  pc = new RTCPeerConnection(rtcConfig);
  pc.onicecandidate = e => e.candidate && socket.emit('webrtc-ice', { code, candidate: e.candidate });
  dataChannel = pc.createDataChannel('file');
  dataChannel.onopen = () => sendFileChunks(dataChannel);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('webrtc-offer', { code, desc: pc.localDescription });
}

async function sendFileChunks(dc){
  const file = fileToSend;
  const size = file.size;
  let offset = 0;
  sendProgress.value = 0;
  logSender('Envoi en cours...');
  while (offset < size) {
    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const ab = await slice.arrayBuffer();
    dc.send(ab);
    offset += ab.byteLength;
    sendProgress.value = Math.round((offset / size) * 100);
  }
  dc.send(JSON.stringify({ done: true, name: file.name, size: file.size }));
  logSender('Fichier envoyé !');
}

// Receiver setup
function prepareReceiver(code){
  pc = new RTCPeerConnection(rtcConfig);
  pc.onicecandidate = e => e.candidate && socket.emit('webrtc-ice', { code, candidate: e.candidate });
  pc.ondatachannel = e => {
    dataChannel = e.channel;
    dataChannel.binaryType = 'arraybuffer';
    dataChannel.onmessage = handleReceive;
    logReceiver('Canal ouvert — réception en cours');
  };
}

function handleReceive(e){
  if (typeof e.data === 'string') {
    try {
      const msg = JSON.parse(e.data);
      if (msg.done) {
        const blob = new Blob(receiveBuffer);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = msg.name;
        a.textContent = `Télécharger ${msg.name}`;
        downloadArea.innerHTML = '';
        downloadArea.appendChild(a);
        logReceiver('Réception terminée');
      }
    } catch {}
  } else {
    receiveBuffer.push(e.data);
    receivedBytes += e.data.byteLength;
    recvProgress.value = Math.min(100, (receivedBytes / (1024 * 1024 * 100)) * 100);
  }
}
