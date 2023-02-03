const e = require("cors");
const io = require("socket.io-client");

// Look after different browser vendors' ways of calling the getUserMedia()
// API method:
// Opera --> getUserMedia
// Chrome --> webkitGetUserMedia
// Firefox --> mozGetUserMedia
navigator.getUserMedia =
	navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

var isSendBye = false;
// Clean-up function:
// collect garbage before unloading browser's window
window.onbeforeunload = function (e) {
	e.preventDefault();
	hangup();
	if (!isSendBye) {
		return "Are you sure you want to leave the call?";
	}
};
// Data channel information
// var sendChannel, receiveChannel;
var sendButton = document.getElementById("sendButton");
var sendTextarea = document.getElementById("dataChannelSend");
var receiveTextarea = document.getElementById("dataChannelReceive");
// HTML5 <video> elements
var localVideo = document.querySelector("#localVideo");
var remoteVideo = document.querySelector("#remoteVideo");
// Handler associated with Send button
sendButton.onclick = sendData;
sendTextarea.addEventListener("keypress", function (event) {
	if (event.key === "Enter") {
		event.preventDefault();
		sendData();
	}
});

// Flags...
var isChannelReady = false;
var isInitiator = false;
var isStarted = false;
var numClients = 0;
var listPc = [];
var listSendDataChannel = [];
var listRecieveChannel = [];
// WebRTC data structures
// Streams
var localStream;
var remoteStream;
var originalStream;
// PeerConnection

// PeerConnection ICE protocol configuration (either Firefox or Chrome)
var pc_config = {
	iceServers: [
		{
			urls: "stun:relay.metered.ca:80",
		},
		{
			urls: "turn:relay.metered.ca:80",
			username: "7d7c879c5731bf89a95eca58",
			credential: "4yNvRI75cj/sQTNV",
		},
		{
			urls: "turn:relay.metered.ca:443",
			username: "7d7c879c5731bf89a95eca58",
			credential: "4yNvRI75cj/sQTNV",
		},
		{
			urls: "turn:relay.metered.ca:443?transport=tcp",
			username: "7d7c879c5731bf89a95eca58",
			credential: "4yNvRI75cj/sQTNV",
		},
		{
			urls: "turn:numb.viagenie.ca",
			credential: "muazkh",
			username: "webrtc@live.com",
		},
	],
};

var pc_constraints = {
	optional: [{ DtlsSrtpKeyAgreement: true }],
};
var sdpConstraints = {};

// Let's get started: prompt user for input (room name)
// var room = prompt("Enter room name:");

// var name = prompt("Enter your name:");
// Connect to signaling server
var socket = io("https://webrtc-demo-server.onrender.com/", {
	transports: ["websocket"],
});

//page home (enter your name, room name)
const roomNameTxt = document.getElementById("roomName");
const yourNameTxt = document.getElementById("yourName");
const joinBtn = document.getElementById("joinBtn");
const streamDiv = document.getElementById("streamDiv");
const homeDiv = document.getElementById("homeDiv");

roomNameTxt.addEventListener("input", (e) => {
	if (roomNameTxt.value !== "" && yourNameTxt.value !== "") {
		joinBtn.disabled = false;
	} else {
		joinBtn.disabled = true;
	}
});
yourNameTxt.addEventListener("input", (e) => {
	if (roomNameTxt.value !== "" && yourNameTxt.value !== "") {
		joinBtn.disabled = false;
	} else {
		joinBtn.disabled = true;
	}
});
yourNameTxt.addEventListener("keypress", function (event) {
	if (event.key === "Enter") {
		event.preventDefault();
		streamDiv.style.display = "block";
		homeDiv.style.display = "none";
		// Send "Create or join" message to singnaling server
		if (roomNameTxt.value !== "") {
			console.log("Create or join room", roomNameTxt.value);
			socket.emit("create or join", roomNameTxt.value);
		}
	}
});
joinBtn.addEventListener("click", (e) => {
	streamDiv.style.display = "block";
	homeDiv.style.display = "none";
	// Send 'Create or join' message to singnaling server
	if (roomNameTxt.value !== "") {
		console.log("Create or join room", roomNameTxt.value);
		socket.emit("create or join", roomNameTxt.value);
	}
});

// var socket = io("http://localhost:8181", {
//   transports: ["websocket"],
// });

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
	navigator.mediaDevices.enumerateDevices().then((devices) => {
		const cams = devices.filter((device) => device.kind == "videoinput");
		const mics = devices.filter((device) => device.kind == "audioinput");

		const constraints = { video: cams.length > 0, audio: mics.length > 0 };
		navigator.getUserMedia(constraints, handleUserMedia, handleUserMediaError);
		console.log("Getting user media with constraints", constraints);
	});
	//navigator.getUserMedia(constraints, handleUserMedia, handleUserMediaError);
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
socket.on("joined", function (numClient) {
	console.log("This peer has joined room " + numClient);
	numClients = numClient;
	isChannelReady = true;
	// Call getUserMedia()
	navigator.mediaDevices.enumerateDevices().then((devices) => {
		const cams = devices.filter((device) => device.kind == "videoinput");
		const mics = devices.filter((device) => device.kind == "audioinput");

		const constraints = { video: cams.length > 0, audio: mics.length > 0 };
		navigator.getUserMedia(constraints, handleUserMedia, handleUserMediaError);
		console.log("Getting user media with constraints", constraints);
	});
	//navigator.getUserMedia(constraints, handleUserMedia, handleUserMediaError);
});
// Server-sent log message...
socket.on("log", function (array) {
	console.log.apply(console, array);
});
// Receive message from the other peer via the signaling server
socket.on("message", function (message) {
	console.log("Received message:", message);
	if (message.message === "got user media") {
		checkAndStart(message.destinationId, message.name);
	} else if (message.message.type === "offer") {
		// if (!isInitiator && !isStarted) {
		//   checkAndStart();
		// }
		isStarted = true;
		if (!message.isSendAll) {
			var newPeer = createPeerConnection(listPc.length, message.name, false, message.destinationId);
			listPc.push({
				pc: newPeer,
				destinationId: message.destinationId,
				sourceId: socket.id,
			});
			newPeer.setRemoteDescription(new RTCSessionDescription(message.message));
			doAnswer(newPeer, message.index, message.destinationId);
		} else {
			listPc.map((item) => {
				if (item.destinationId == message.sourceId) {
					item.pc.setRemoteDescription(new RTCSessionDescription(message.message));
					doAnswer(item.pc, message.index, message.destinationId);
				}
			});
		}
	} else if (message.message.type === "answer" && isStarted) {
		console.log(message);
		listPc.map((item) => {
			if (item.destinationId === message.sourceId) {
				item.pc.setRemoteDescription(new RTCSessionDescription(message.message));
			}
		});
	} else if (message.message.type === "candidate" && isStarted) {
		var candidate = new RTCIceCandidate({
			sdpMLineIndex: message.message.label,
			candidate: message.message.candidate,
		});
		listPc.map((item) => {
			if (item.pc && item.pc.remoteDescription) {
				item.pc.addIceCandidate(candidate);
			}
		});
		// pc.addIceCandidate(candidate);
	} else if (message.message === "bye") {
		handleRemoteHangup(message.sourceId);
	}
});
// 2. Client-->Server
// Send message to the other peer via the signaling server
function sendMessage(message, index = -1, destinationId = null, isSendAll = false) {
	console.log("Sending message: ", {
		message,
		room: roomNameTxt.value,
		index,
		sourceId: socket.id,
		destinationId: destinationId,
		isSendAll: isSendAll,
	});
	socket.emit("message", {
		name: yourNameTxt.value,
		message: message,
		room: roomNameTxt.value,
		index: index,
		sourceId: socket.id,
		destinationId: destinationId,
		isSendAll: isSendAll,
	});
}
// Channel negotiation trigger function
function checkAndStart(destinationId, name) {
	if (typeof localStream != "undefined") {
		console.log(isInitiator);
		var newPeer = createPeerConnection(listPc.length, name, true, destinationId);
		listPc.push({
			pc: newPeer,
			destinationId: destinationId,
			sourceId: socket.id,
		});
		isStarted = true;

		doCall(newPeer, destinationId);
	}
}
// PeerConnection management...
function createPeerConnection(index, name, isFromOffer = false, destinationId = null) {
	try {
		var peerConnection = new RTCPeerConnection(pc_config, pc_constraints);
		if (!localVideo.hidden) {
			peerConnection.addStream(localStream);
		} else {
			var canvasStream = canvasOutput.captureStream();
			peerConnection.addStream(canvasStream);
		}
		peerConnection.onicecandidate = () => handleIceCandidate(event);
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
	peerConnection.onaddstream = (event) => handleRemoteStreamAdded(event, index, name);
	peerConnection.onremovestream = handleRemoteStreamRemoved;
	peerConnection.oniceconnectionstatechange = () =>
		handleConnectionStateChange(peerConnection, destinationId);
	if (isFromOffer) {
		try {
			// Create a reliable data channel
			var newSendChannel = peerConnection.createDataChannel("sendDataChannel" + index, {
				reliable: true,
			});
			console.log("Created send data channel");
		} catch (e) {
			alert("Failed to create data channel. ");
			console.log("createDataChannel() failed with exception: " + e.message);
		}
		newSendChannel.onopen = () => handleSendChannelStateChange(newSendChannel);
		newSendChannel.onmessage = handleMessage;
		newSendChannel.onclose = () => handleSendChannelStateChange(newSendChannel);

		listSendDataChannel.push(newSendChannel);
	} else {
		// Joiner
		peerConnection.ondatachannel = gotReceiveChannel;
	}

	return peerConnection;
}

function handleConnectionStateChange(pc, destinationId) {
	if (pc.iceConnectionState == "disconnected") {
		handleRemoteHangup(destinationId);
	}
}

function replaceURLs(message) {
	if (!message) return;

	var urlRegex = /(((https?:\/\/)|(www\.))[^\s]+)/g;
	return message.replace(urlRegex, function (url) {
		var hyperlink = url;
		if (!hyperlink.match("^https?://")) {
			hyperlink = "http://" + hyperlink;
		}
		return '<a href="' + hyperlink + '" target="_blank" rel="noopener noreferrer">' + url + "</a>";
	});
}
// Data channel management
function sendData() {
	var data = { message: sendTextarea.value, name: yourNameTxt.value };
	// var data = sendTextarea.value;
	// if (isInitiator) sendChannel.send(data);
	// else receiveChannel.send(data);

	console.log("send data");

	newMessage = document.createElement("p");
	newMessage.innerHTML = replaceURLs("You: " + data.message);
	newMessage.style.wordWrap = "break-word";
	newMessage.className = "myMessage";
	receiveTextarea.appendChild(newMessage);

	data = JSON.stringify(data);

	listSendDataChannel.map((sendDataChannel) => {
		sendDataChannel.send(data);
	});

	listRecieveChannel.map((receiveDataChannel) => {
		receiveDataChannel.send(data);
	});
	console.log("Sent data: " + data);

	sendTextarea.value = "";
	sendButton.disabled = true;
}
// Handlers...
function gotReceiveChannel(event) {
	console.log("Receive Channel Callback");
	console.log(event);
	var newReceiveChannel = event.channel;
	newReceiveChannel.onmessage = handleMessage;
	newReceiveChannel.onopen = () => handleReceiveChannelStateChange(newReceiveChannel);
	newReceiveChannel.onclose = () => handleReceiveChannelStateChange(newReceiveChannel);
	listRecieveChannel.push(newReceiveChannel);
}
function handleMessage(event) {
	console.log("Received message: " + event.data);
	var data = JSON.parse(event.data);
	newMessage = document.createElement("p");
	newMessage.innerHTML = replaceURLs(data.name + ": " + data.message);
	newMessage.style.wordWrap = "break-word";
    newMessage.className = "guestMessage";
	receiveTextarea.appendChild(newMessage);
}
function handleSendChannelStateChange(sendDataChannel) {
	var readyState = sendDataChannel.readyState;
	console.log("Send channel state is: " + readyState);
	// If channel ready, enable user's input
	if (readyState == "open") {
		dataChannelSend.disabled = false;
		dataChannelSend.focus();
		sendButton.disabled = false;
	} else {
		dataChannelSend.disabled = true;
		sendButton.disabled = true;
	}
}
function handleReceiveChannelStateChange(receiveChannel) {
	var readyState = receiveChannel.readyState;
	console.log("Receive channel state is: " + readyState);
	// If channel ready, enable user's input
	if (readyState == "open") {
		dataChannelSend.disabled = false;
		dataChannelSend.focus();
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
function doCall(peerConnection, destinationId) {
	console.log("Creating Offer...");
	peerConnection.createOffer(
		(sessionDescription) =>
			setLocalAndSendMessage(sessionDescription, peerConnection, listPc.length - 1, destinationId),
		onSignalingError,
		sdpConstraints
	);
}
// Signaling error handler
function onSignalingError(error) {
	console.log("Failed to create signaling message : " + error.name);
}
// Create Answer
function doAnswer(peerConnection, index, destinationId) {
	console.log("Sending answer to peer.");
	peerConnection.createAnswer(
		(sessionDescription) =>
			setLocalAndSendMessage(sessionDescription, peerConnection, index, destinationId),
		onSignalingError,
		sdpConstraints
	);
}
// Success handler for both createOffer()
// and createAnswer()
function setLocalAndSendMessage(
	sessionDescription,
	peerConnection,
	index,
	destinationId = null,
	isSendAll = false
) {
	console.log("setLocalAndSendMessage", sessionDescription);
	console.log("peerConnection", peerConnection);
	peerConnection.setLocalDescription(sessionDescription);
	sendMessage(sessionDescription, index, destinationId, isSendAll);
}
// Remote stream handlers...
function handleRemoteStreamAdded(event, index, name) {
	var video = document.getElementById("video" + index);
	if (!video) {
		console.log("Remote stream added.");

		var divTag = document.createElement("div");
		divTag.setAttribute("id", "div" + index);
		divTag.setAttribute("class", "videoContainer");
        divTag.setAttribute("class", "xyz");

		var nameTag = document.createElement("p");
		nameTag.innerHTML = name;

		var divOverlay = document.createElement("div");
		divOverlay.setAttribute("class", "overlay");
		divOverlay.style.cssText +=
			"position: absolute; bottom: 0; left: 10px; z-index:1; color: white; font-size: 24px;";
		divOverlay.appendChild(nameTag);

		divTag.appendChild(divOverlay);

		video = document.createElement("video");
		video.setAttribute("id", "video" + index);
		video.muted = false;
		video.autoplay = true;
		video.style.cssText += "position: relative; z-index: 0;";
		video.setAttribute("poster", "https://i.postimg.cc/j5kb1NB4/Unknown-person.jpg");

		outer = document.createElement("div");
		outer.setAttribute("class", "outer");
        outer.appendChild(video);

		divTag.appendChild(outer);
        divTag.childNodes[1].className += " full";
        divTag.childNodes[1].childNodes[0].className += " full";

        const td = document.getElementById("remoteContainer");
		td.appendChild(divTag);

        var len = td.childNodes.length
        if (len == 1) {
            for (let i = 0; i < len; i++) {
                td.childNodes[i].className = "two"
            }
        } else if (len > 4) {
            for (let i = 0; i < len; i++) {
                td.childNodes[i].className = "nine"
                if ((len ==5 && i >2) || (len ==8&&i>5)) {
                    td.childNodes[i].className = "four"
                }
            }
        } else {
            for (let i = 0; i < len; i++) {
                td.childNodes[i].className = "four"
            }
        }
    }

	//attachMediaStream(remoteVideo, event.stream);
	if (window.URL) {
		if ("srcObject" in video) {
			if (event.stream.getVideoTracks().length > 0) {
				video.srcObject = event.stream;
			}
		} else {
			video.src = window.URL.createObjectURL(event.stream);
		}
	} else {
		video.src = event.stream;
	}
	console.log("Remote stream attached!!.");
	video = event.stream;
}

function handleRemoteStreamRemoved(event) {
	console.log("Remote stream removed. Event: ", event);
}
// Clean-up functions...
function hangup() {
	console.log("Hanging up.");
	stop();
	listPc.map((item) => {
		sendMessage("bye", -1, item.destinationId);
	});
	isSendBye = true;
	window.close();
}
function handleRemoteHangup(remoteSocketId) {
	console.log("Session terminated.");
	stop(remoteSocketId);
	receiveTextarea.value = null;
	sendTextarea.value = null;
    const td = document.getElementById("remoteContainer");
        var len = td.childNodes.length
        if (len == 1) {
            for (let i = 0; i < len; i++) {
                td.childNodes[i].className = "two"
            }
        } else if (len > 4) {
            for (let i = 0; i < len; i++) {
                td.childNodes[i].className = "nine"
                if ((len ==5 && i >2) || (len ==8&&i>5)) {
                    td.childNodes[i].className = "four"
                }
            }
        } else {
            for (let i = 0; i < len; i++) {
                td.childNodes[i].className = "four"
            }
        }
	// isInitiator = false;
}
function stop(remoteSocketId) {
	isStarted = false;

	// if (sendChannel) sendChannel.close();
	// if (receiveChannel) receiveChannel.close();
	listPc.map((item, index) => {
		console.log(item.destinationId);
		console.log(remoteSocketId);
		console.log(index);
		if (item.destinationId === remoteSocketId) {
			if (item.pc) {
				item.pc.close();
				item.pc = null;
				const video = document.getElementById("div" + index);
				video.remove();
			}
		}
	});
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

const noBackgroundBtn = document.getElementById("noBackground");
const blurBackgroundBtn = document.getElementById("blurBackground");
const virutalBackgroundBtn = document.getElementById("virutalBackground");
const microBtn = document.getElementById("micro");
const unmuteBtn = document.getElementById("unmute");
const muteBtn = document.getElementById("mute");
const cameraBtn = document.getElementById("camera");
const cameraOnBtn = document.getElementById("cameraOn");
const cameraOffBtn = document.getElementById("cameraOff");
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
	while (selectedLibrary === "bodypix" && (blurredEnabled || virtualBackgroundEnabled)) {
		segmentationMaskCtx.clearRect(0, 0, canvasOutput.width, canvasOutput.height);
		segmentationMaskCtx.drawImage(localVideo, 0, 0, canvasOutput.width, canvasOutput.height);

		const segmentation = await net.segmentPerson(segmentationMaskCanvas);
		for (let i = 0; i < segmentationPixelCount; i++) {
			// Sets only the alpha component of each pixel
			segmentationMask.data[i * 4 + 3] = segmentation.data[i] ? 255 : 0;
		}
		segmentationMaskCtx.putImageData(segmentationMask, 0, 0);

		runPostProcessing(localVideo, segmentationMaskCanvas, backgroundBlurRange.value);
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
function onLibraryLoad(library = "bodypix") {
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
	listPc.map((item, index) => {
		item.pc.addStream(stream);
		item.pc.createOffer(
			(sessionDescription) =>
				setLocalAndSendMessage(sessionDescription, item.pc, index, item.destinationId, true),
			onSignalingError,
			sdpConstraints
		);
	});

	libraryLoaded = false;
}

function setResultStream() {
	localVideo.hidden = true;
	const stream = canvasOutput.captureStream();

	console.log(stream);
	listPc.map((item, index) => {
		item.pc.addStream(stream);
		item.pc.createOffer(
			(sessionDescription) =>
				setLocalAndSendMessage(sessionDescription, item.pc, index, item.destinationId, true),
			onSignalingError,
			sdpConstraints
		);
	});
}

noBackgroundBtn.addEventListener("click", (e) => {
	document.getElementById("controlCard").hidden = true;
	blurredEnabled = true;
	isNone = true;
	virtualBackgroundEnabled = false;
	backgroundBlurRange.disabled = true;
	edgeBlurRange.disabled = true;

	noBackgroundBtn.classList.add("selected");
	blurBackgroundBtn.classList.remove("selected");
	virutalBackgroundBtn.classList.remove("selected");

	if (!libraryLoaded) {
		onLibraryLoad("none");
	}
});

blurBackgroundBtn.addEventListener("click", (e) => {
	document.getElementById("controlCard").hidden = false;
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
		onLibraryLoad();
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

	selectedBackground = document.getElementById("virtualImage");

	if (!libraryLoaded) {
		console.log(1);
		onLibraryLoad();
	} else if (selectedLibrary === "vectorly") {
		changeBackground(selectedBackground.src);
	}
});

microBtn.addEventListener("click", (e) => {
	if (localStream && localStream.getAudioTracks().length > 0) {
		localStream.getAudioTracks()[0].enabled = !localStream.getAudioTracks()[0].enabled;
		if (localStream.getAudioTracks()[0].enabled) {
			muteBtn.style.display = "none";
			unmuteBtn.style.display = "block";
			microBtn.style.backgroundColor = "#3C4043";
			microBtn.title = "Turn off microphone";
		} else {
			muteBtn.style.display = "block";
			unmuteBtn.style.display = "none";
			microBtn.style.backgroundColor = "red";
			microBtn.title = "Turn on microphone";
		}
	} else {
		muteBtn.style.display = "block";
		unmuteBtn.style.display = "none";
		microBtn.style.backgroundColor = "red";
		microBtn.title = "Turn on microphone";
	}
});

cameraBtn.addEventListener("click", (e) => {
	if (localStream && localStream.getVideoTracks().length > 0) {
		localStream.getVideoTracks()[0].enabled = !localStream.getVideoTracks()[0].enabled;
		cameraBtn.classList.toggle("turned-off");
		if (localStream.getVideoTracks()[0].enabled) {
			cameraOffBtn.style.display = "none";
			cameraOnBtn.style.display = "block";
			cameraBtn.style.backgroundColor = "#3C4043";
			cameraBtn.title = "Turn off camera";
		} else {
			cameraOffBtn.style.display = "block";
			cameraOnBtn.style.display = "none";
			cameraBtn.style.backgroundColor = "red";
			cameraBtn.title = "Turn on camera";
		}
	} else {
		cameraOffBtn.style.display = "block";
		cameraOnBtn.style.display = "none";
		cameraBtn.style.backgroundColor = "red";
		cameraBtn.title = "Turn on camera";
	}
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

dataChannelSend.addEventListener("input", (e) => {
	console.log(dataChannelSend.value);
	if (dataChannelSend.value !== "") {
		sendButton.disabled = false;
	} else {
		sendButton.disabled = true;
	}
});
