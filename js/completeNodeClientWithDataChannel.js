const io = require("socket.io-client");
// Look after different browser vendors' ways of calling the getUserMedia()
// API method:
// Opera --> getUserMedia
// Chrome --> webkitGetUserMedia
// Firefox --> mozGetUserMedia
navigator.getUserMedia =
  navigator.getUserMedia ||
  navigator.webkitGetUserMedia ||
  navigator.mozGetUserMedia;
// Clean-up function:
// collect garbage before unloading browser's window
window.onbeforeunload = function (e) {
  hangup();
};
// Data channel information
var sendChannel, receiveChannel;
var sendButton = document.getElementById("sendButton");
var sendTextarea = document.getElementById("dataChannelSend");
var receiveTextarea = document.getElementById("dataChannelReceive");
// HTML5 <video> elements
var localVideo = document.querySelector("#localVideo");
var remoteVideo = document.querySelector("#remoteVideo");
// Handler associated with Send button
sendButton.onclick = sendData;
// Flags...
var isChannelReady = false;
var isInitiator = false;
var isStarted = false;
// WebRTC data structures
// Streams
var localStream;
var remoteStream;
var originalStream;
// PeerConnection
var pc;

// PeerConnection ICE protocol configuration (either Firefox or Chrome)
var pc_config =
  //   webrtcDetectedBrowser === "firefox"
  // ? { iceServers: [{ url: "stun:23.21.150.121" }] } // IP address
  // :
  { iceServers: [{ url: "stun:stun.l.google.com:19302" }] };

var pc_constraints = {
  optional: [{ DtlsSrtpKeyAgreement: true }],
};
var sdpConstraints = {};
// Let's get started: prompt user for input (room name)
var room = prompt("Enter room name:");
// Connect to signaling server
var socket = io("https://webrtc-demo-se400.herokuapp.com/", {
  transports: ["websocket"],
});

// Send 'Create or join' message to singnaling server
if (room !== "") {
  console.log("Create or join room", room);
  socket.emit("create or join", room);
}
// Set getUserMedia constraints
var constraints = { video: true, audio: true };
// From this point on, execution proceeds based on asynchronous events...
// getUserMedia() handlers...
function handleUserMedia(stream) {
  localStream = stream;
  originalStream = stream;
  //attachMediaStream(localVideo, stream);
  if (window.URL) {
    if ("srcObject" in localVideo) {
      localVideo.srcObject = stream;
    } else {
      localVideo.src = window.URL.createObjectURL(stream);
    }
  } else {
    localVideo.src = stream;
  }
  console.log("Adding local stream.");
  sendMessage("got user media");
}
function handleUserMediaError(error) {
  console.log("navigator.getUserMedia error: ", error);
}
// Server-mediated message exchanging...
// 1. Server-->Client...
// Handle 'created' message coming back from server:
// this peer is the initiator
socket.on("created", function (room) {
  console.log("Created room " + room);
  isInitiator = true;
  // Call getUserMedia()
  navigator.getUserMedia(constraints, handleUserMedia, handleUserMediaError);
  console.log("Getting user media with constraints", constraints);
  checkAndStart();
});
// Handle 'full' message coming back from server:
// this peer arrived too late :-(
socket.on("full", function (room) {
  console.log("Room " + room + " is full");
});
// Handle 'join' message coming back from server:
// another peer is joining the channel
socket.on("join", function (room) {
  console.log("Another peer made a request to join room " + room);
  console.log("This peer is the initiator of room " + room + "!");
  isChannelReady = true;
});
// Handle 'joined' message coming back from server:
// this is the second peer joining the channel
socket.on("joined", function (room) {
  console.log("This peer has joined room " + room);
  isChannelReady = true;
  // Call getUserMedia()
  navigator.getUserMedia(constraints, handleUserMedia, handleUserMediaError);
  console.log("Getting user media with constraints", constraints);
});
// Server-sent log message...
socket.on("log", function (array) {
  console.log.apply(console, array);
});
// Receive message from the other peer via the signaling server
socket.on("message", function (message) {
  console.log("Received message:", message);
  if (message === "got user media") {
    checkAndStart();
  } else if (message.type === "offer") {
    if (!isInitiator && !isStarted) {
      checkAndStart();
    }
    pc.setRemoteDescription(new RTCSessionDescription(message));
    doAnswer();
  } else if (message.type === "answer" && isStarted) {
    pc.setRemoteDescription(new RTCSessionDescription(message));
  } else if (message.type === "candidate" && isStarted) {
    var candidate = new RTCIceCandidate({
      sdpMLineIndex: message.label,
      candidate: message.candidate,
    });
    pc.addIceCandidate(candidate);
  } else if (message === "bye" && isStarted) {
    handleRemoteHangup();
  }
});
// 2. Client-->Server
// Send message to the other peer via the signaling server
function sendMessage(message) {
  console.log("Sending message: ", message);
  socket.emit("message", { message, room });
}
// Channel negotiation trigger function
function checkAndStart() {
  if (!isStarted && typeof localStream != "undefined" && isChannelReady) {
    console.log(isInitiator);
    createPeerConnection();
    isStarted = true;

    if (isInitiator) {
      doCall();
    }
  }
}
// PeerConnection management...
function createPeerConnection() {
  try {
    pc = new RTCPeerConnection(pc_config, pc_constraints);
    pc.addStream(localStream);
    pc.onicecandidate = handleIceCandidate;
    console.log(
      "Created RTCPeerConnnection with:\n" +
        " config: '" +
        JSON.stringify(pc_config) +
        "';\n" +
        " constraints: '" +
        JSON.stringify(pc_constraints) +
        "'."
    );
  } catch (e) {
    console.log("Failed to create PeerConnection, exception: " + e.message);
    alert("Cannot create RTCPeerConnection object.");
    return;
  }
  pc.onaddstream = handleRemoteStreamAdded;
  pc.onremovestream = handleRemoteStreamRemoved;
  if (isInitiator) {
    try {
      // Create a reliable data channel
      sendChannel = pc.createDataChannel("sendDataChannel", { reliable: true });
      console.log("Created send data channel");
    } catch (e) {
      alert("Failed to create data channel. ");
      console.log("createDataChannel() failed with exception: " + e.message);
    }
    sendChannel.onopen = handleSendChannelStateChange;
    sendChannel.onmessage = handleMessage;
    sendChannel.onclose = handleSendChannelStateChange;
  } else {
    // Joiner
    pc.ondatachannel = gotReceiveChannel;
  }
}
// Data channel management
function sendData() {
  var data = sendTextarea.value;
  if (isInitiator) sendChannel.send(data);
  else receiveChannel.send(data);
  console.log("Sent data: " + data);
}
// Handlers...
function gotReceiveChannel(event) {
  console.log("Receive Channel Callback");
  receiveChannel = event.channel;
  receiveChannel.onmessage = handleMessage;
  receiveChannel.onopen = handleReceiveChannelStateChange;
  receiveChannel.onclose = handleReceiveChannelStateChange;
}
function handleMessage(event) {
  console.log("Received message: " + event.data);
  receiveTextarea.value = event.data + "\n";
}
function handleSendChannelStateChange() {
  var readyState = sendChannel.readyState;
  console.log("Send channel state is: " + readyState);
  // If channel ready, enable user's input
  if (readyState == "open") {
    dataChannelSend.disabled = false;
    dataChannelSend.focus();
    dataChannelSend.placeholder = "";
    sendButton.disabled = false;
  } else {
    dataChannelSend.disabled = true;
    sendButton.disabled = true;
  }
}
function handleReceiveChannelStateChange() {
  var readyState = receiveChannel.readyState;
  console.log("Receive channel state is: " + readyState);
  // If channel ready, enable user's input
  if (readyState == "open") {
    dataChannelSend.disabled = false;
    dataChannelSend.focus();
    dataChannelSend.placeholder = "";
    sendButton.disabled = false;
  } else {
    dataChannelSend.disabled = true;
    sendButton.disabled = true;
  }
}
// ICE candidates management
function handleIceCandidate(event) {
  console.log("handleIceCandidate event: ", event);
  if (event.candidate) {
    sendMessage({
      type: "candidate",
      label: event.candidate.sdpMLineIndex,
      id: event.candidate.sdpMid,
      candidate: event.candidate.candidate,
    });
  } else {
    console.log("End of candidates.");
  }
}
// Create Offer
function doCall() {
  console.log("Creating Offer...");
  pc.createOffer(setLocalAndSendMessage, onSignalingError, sdpConstraints);
}
// Signaling error handler
function onSignalingError(error) {
  console.log("Failed to create signaling message : " + error.name);
}
// Create Answer
function doAnswer() {
  console.log("Sending answer to peer.");
  pc.createAnswer(setLocalAndSendMessage, onSignalingError, sdpConstraints);
}
// Success handler for both createOffer()
// and createAnswer()
function setLocalAndSendMessage(sessionDescription) {
  pc.setLocalDescription(sessionDescription);
  sendMessage(sessionDescription);
}
// Remote stream handlers...
function handleRemoteStreamAdded(event) {
  console.log("Remote stream added.");
  //attachMediaStream(remoteVideo, event.stream);
  if (window.URL) {
    if ("srcObject" in remoteVideo) {
      remoteVideo.srcObject = event.stream;
    } else {
      remoteVideo.src = window.URL.createObjectURL(event.stream);
    }
  } else {
    remoteVideo.src = event.stream;
  }
  console.log("Remote stream attached!!.");
  remoteStream = event.stream;
}

function handleRemoteStreamRemoved(event) {
  console.log("Remote stream removed. Event: ", event);
}
// Clean-up functions...
function hangup() {
  console.log("Hanging up.");
  stop();
  sendMessage("bye");
}
function handleRemoteHangup() {
  console.log("Session terminated.");
  stop();
  receiveTextarea.value = null;
  sendTextarea.value = null;
  // isInitiator = false;
}
function stop() {
  isStarted = false;
  if (sendChannel) sendChannel.close();
  if (receiveChannel) receiveChannel.close();
  if (pc) pc.close();
  pc = null;
  sendButton.disabled = true;
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////

let vectorlyFilter = null;
let selectedLibrary = "bodypix";
let selectedBackground = null;
let blurredEnabled = false;
let isNone = false;
let virtualBackgroundEnabled = false;
let selfieSegmentation = null;
let libraryLoaded = false;

const canvasOutput = document.getElementById("localCanvas");
const ctx = canvasOutput.getContext("2d");

const segmentationWidth = 480;
const segmentationHeight = 320;
const segmentationPixelCount = segmentationWidth * segmentationHeight;
const segmentationMask = new ImageData(segmentationWidth, segmentationHeight);
const segmentationMaskCanvas = document.createElement("canvas");
segmentationMaskCanvas.width = segmentationWidth;
segmentationMaskCanvas.height = segmentationHeight;
const segmentationMaskCtx = segmentationMaskCanvas.getContext("2d");

const librarySelect = document.getElementById("librarySelect");
const noBackgroundBtn = document.getElementById("noBackground");
const blurBackgroundBtn = document.getElementById("blurBackground");
const virutalBackgroundBtn = document.getElementById("virutalBackground");
const backgroundBlurRange = document.getElementById("backgroundBlur");
const blurAmountText = document.getElementById("blurAmount");
blurAmountText.innerText = backgroundBlurRange.value;

const edgeBlurRange = document.getElementById("edgeBlur");
const edgeBlurAmountText = document.getElementById("edgeBlurAmount");
edgeBlurAmountText.innerText = edgeBlurRange.value;

//#endregion

//#region Bodypix
async function loadBodyPix() {
  try {
    const net = await bodyPix.load();
    canvasOutput.hidden = false;
    perform(net);
  } catch (err) {
    console.log(err);
  }
}

async function perform(net) {
  while (
    selectedLibrary === "bodypix" &&
    (blurredEnabled || virtualBackgroundEnabled)
  ) {
    segmentationMaskCtx.clearRect(
      0,
      0,
      canvasOutput.width,
      canvasOutput.height
    );
    segmentationMaskCtx.drawImage(
      localVideo,
      0,
      0,
      canvasOutput.width,
      canvasOutput.height
    );

    const segmentation = await net.segmentPerson(segmentationMaskCanvas);
    for (let i = 0; i < segmentationPixelCount; i++) {
      // Sets only the alpha component of each pixel
      segmentationMask.data[i * 4 + 3] = segmentation.data[i] ? 255 : 0;
    }
    segmentationMaskCtx.putImageData(segmentationMask, 0, 0);

    runPostProcessing(
      localVideo,
      segmentationMaskCanvas,
      backgroundBlurRange.value
    );
  }
}
//#endregion

function runPostProcessing(image, segmentation, blurAmount) {
  clearCanvas();

  ctx.globalCompositeOperation = "copy";
  ctx.filter = "none";

  if (blurredEnabled || virtualBackgroundEnabled) {
    ctx.filter = `blur(${edgeBlurRange.value}px)`;
    drawSegmentationMask(segmentation);
    ctx.globalCompositeOperation = "source-in";
    ctx.filter = "none";
  }

  ctx.drawImage(image, 0, 0, canvasOutput.width, canvasOutput.height);

  if (virtualBackgroundEnabled) {
    blurBackground(selectedBackground, 0);
  }

  if (blurredEnabled) {
    if (isNone) {
      blurAmount = 0;
    }
    blurBackground(image, blurAmount);
  }

  ctx.restore();
}

function drawSegmentationMask(segmentation) {
  ctx.drawImage(segmentation, 0, 0, canvasOutput.width, canvasOutput.height);
}

function blurBackground(image, blurAmount) {
  ctx.globalCompositeOperation = "destination-over";
  ctx.filter = `blur(${blurAmount}px)`;
  ctx.drawImage(image, 0, 0, canvasOutput.width, canvasOutput.height);
}

function clearCanvas() {
  ctx.clearRect(0, 0, canvasOutput.width, canvasOutput.height);
}

/* eslint-disable default-case */
function onLibraryLoad(library) {
  libraryLoaded = true;
  switch (library) {
    case "bodypix":
      loadBodyPix();
      setResultStream();
      break;
  }

  if (library === "bodypix") {
    backgroundBlurRange.max = 20;
  } else {
    if (backgroundBlurRange.value > 10) {
      backgroundBlurRange.value = 10;
      blurAmountText.innerText = backgroundBlurRange.value;
    }

    backgroundBlurRange.max = 10;
  }
}

/* eslint-disable default-case */
async function onLibraryUnload(library) {
  clearCanvas();

  switch (library) {
    case "bodypix":
      localVideo.hidden = false;
      canvasOutput.hidden = true;
      break;
  }

  const stream = localVideo.captureStream();
  pc.addStream(stream);
  pc.createOffer(setLocalAndSendMessage, onSignalingError, sdpConstraints);
  libraryLoaded = false;
}

function setResultStream() {
  localVideo.hidden = true;
  const stream = canvasOutput.captureStream();
  pc.addStream(stream);
  pc.createOffer(setLocalAndSendMessage, onSignalingError, sdpConstraints);
}

noBackgroundBtn.addEventListener("click", (e) => {
  blurredEnabled = true;
  isNone = true;
  virtualBackgroundEnabled = false;
  backgroundBlurRange.disabled = true;
  edgeBlurRange.disabled = true;

  noBackgroundBtn.classList.add("selected");
  blurBackgroundBtn.classList.remove("selected");
  virutalBackgroundBtn.classList.remove("selected");

  if (!libraryLoaded) {
    onLibraryLoad(librarySelect.value);
  }
  // onLibraryLoad(librarySelect.value);
});

blurBackgroundBtn.addEventListener("click", (e) => {
  blurredEnabled = true;
  isNone = false;
  virtualBackgroundEnabled = false;
  backgroundBlurRange.disabled = false;

  if (selectedLibrary !== "vectorly") {
    edgeBlurRange.disabled = false;
  } else {
    edgeBlurRange.disabled = true;
  }

  noBackgroundBtn.classList.remove("selected");
  blurBackgroundBtn.classList.add("selected");
  virutalBackgroundBtn.classList.remove("selected");

  if (!libraryLoaded) {
    console.log(1);
    onLibraryLoad(librarySelect.value);
  } else if (selectedLibrary === "vectorly") {
    changeBackground("blur");
  }
});

virutalBackgroundBtn.addEventListener("click", (e) => {
  blurredEnabled = false;
  virtualBackgroundEnabled = true;
  backgroundBlurRange.disabled = true;

  if (selectedLibrary !== "vectorly") {
    edgeBlurRange.disabled = false;
  } else {
    edgeBlurRange.disabled = true;
  }

  noBackgroundBtn.classList.remove("selected");
  blurBackgroundBtn.classList.remove("selected");
  virutalBackgroundBtn.classList.add("selected");

  selectedBackground = e.target;

  if (!libraryLoaded) {
    console.log(1);
    onLibraryLoad(librarySelect.value);
  } else if (selectedLibrary === "vectorly") {
    changeBackground(selectedBackground.src);
  }
});

librarySelect.addEventListener("input", (e) => {
  if (selectedLibrary !== e.target.value) {
    onLibraryUnload(selectedLibrary);
  }

  selectedLibrary = e.target.value;

  if (!blurredEnabled && !virtualBackgroundEnabled) return;

  if (selectedLibrary === "vectorly") {
    edgeBlurRange.disabled = true;
  }

  onLibraryLoad(e.target.value);
});

backgroundBlurRange.addEventListener("input", (e) => {
  blurAmountText.innerText = e.target.value;

  if (selectedLibrary === "vectorly") {
    vectorlyFilter.changeBlurRadius(e.target.value);
  }
});

edgeBlurRange.addEventListener("input", (e) => {
  edgeBlurAmountText.innerText = e.target.value;
});
