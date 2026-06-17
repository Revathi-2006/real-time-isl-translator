const socket = io();

let history=[];
let room = "";
let sentence = [];
let myId = "";   // ✅ ADD

// ✅ GET MY SOCKET ID
socket.on("connect", ()=>{
    myId = socket.id;
});


const text = "🤟 ISL Communicator";
let i = 0;

function typeEffect(){
    if(i < text.length){
        document.getElementById("typingText").innerHTML += text.charAt(i);
        i++;
        setTimeout(typeEffect, 50);
    }
}

// start typing on load
window.onload = typeEffect;

// ================= CAMERA =================
async function startCamera(){
    const stream = await navigator.mediaDevices.getUserMedia({ video:true });
    document.getElementById("localVideo").srcObject = stream;
    sendFrames();
}

function enterApp(){

    const screen = document.getElementById("welcomeScreen");

    screen.style.opacity = "0";
    screen.style.transition = "0.8s";

    setTimeout(()=>{
        screen.style.display = "none";
        document.getElementById("mainContent").style.display = "block";
        startCamera();
    },800);
}


// ================= SEND VIDEO =================
function sendFrames(){
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    setInterval(()=>{
        const video = document.getElementById("localVideo");

        if(!video.videoWidth) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        ctx.drawImage(video,0,0);

        socket.emit("video_frame", canvas.toDataURL("image/jpeg"));

    },150);
}


// ================= JOIN =================
function joinRoom(){
    room = document.getElementById("roomInput").value;

    if(room===""){
        alert("Enter Room ID");
        return;
    }

    socket.emit("join_room",{room});
}


// ================= MODE =================
function setMode(mode){
    socket.emit("set_mode",{mode});
    document.getElementById("status").innerText = "Mode: " + mode;
    showToast("Switched to " + mode);
}


// ================= SEND TEXT =================
function sendText(){

    let text = document.getElementById("textInput").value;

    if(text==="") return;

    text = text.toUpperCase();

    let words = text.toUpperCase().split(" ");
    words.forEach(w=>{
        if(w.trim()!==""){
            sentence.push(w);
        }
    })

    updateSentenceUI();

    socket.emit("chat_message",{room,text});

    document.getElementById("textInput").value = "";
}


// ENTER KEY
document.getElementById("textInput").addEventListener("keypress", function(e){
    if(e.key === "Enter"){
        sendText();
    }
});


// ================= QUICK BUTTON =================
function quickSend(word){

    sentence.push(word);
    updateSentenceUI();

    socket.emit("chat_message",{room, text:word});
}


// ================= RECEIVE =================
socket.on("chat_message", data=>{

    if(!data.text) return;

    const senderLabel = (data.sender === myId) ? "User 1" : "User 2";  // ✅ ADD

    addMessage(senderLabel + ": " + data.text);  // ✅ MODIFIED
    playSign(data.text);
    triggerGlow();
});

// ================= REMOTE VIDEO =================
socket.on("remote_frame", data=>{
    document.getElementById("remoteVideo").src = data;
});


// ================= MESSAGE =================
function addMessage(text, isMe){

    let box = document.getElementById("messages");

    let align = isMe ? "flex-end" : "flex-start";
    let bg = isMe ? "#22c55e" : "#334155";
    let radius = isMe ? "15px 15px 0 15px" : "15px 15px 15px 0";

    let time = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });

    box.innerHTML += `
    <div style="
        display:flex;
        justify-content:${align};
        animation: fadeMessage 0.3s ease;
    ">
        <div style="
            background:${bg};
            padding:10px 15px;
            border-radius:${radius};
            margin:6px;
            max-width:65%;
            position:relative;
            font-size:14px;
        ">
            ${text}

            <div style="
                font-size:10px;
                margin-top:4px;
                opacity:0.7;
                text-align:right;
            ">
                ${time}
            </div>
        </div>
    </div>
    `;

    box.scrollTop = box.scrollHeight;

    history.push(text);
    updateHistoryUI();
}

// ================= SIGN PLAYBACK =================
function playSign(text){

    const video = document.getElementById("signVideo");
    const img = document.getElementById("signImage");

    const phrase = text.toUpperCase().replace(/ /g,"_");

    const trained = [
        "HELLO","HELP","YES","PLEASE","THANKYOU",
        "STOP","OK","WATER","SORRY","WAIT",
        "GOOD_MORNING","HOW_ARE_YOU","SEE_YOU_LATER"
    ];

    video.pause();
    video.style.display = "none";
    img.style.display = "none";

    if(trained.includes(phrase)){

        video.src = "/sign_videos/" + phrase + ".mp4";
        video.muted = true;

        video.onloadeddata = ()=> video.play();

        video.style.display = "block";

    } else {

        img.src = "/sign_images/" + phrase + ".JPEG";

        img.onload = ()=>{
            img.style.display = "block";
        };
    }
}


// ================= SENTENCE UI =================
function updateSentenceUI(){
    document.getElementById("sentenceBox").innerText = sentence.join(" ");
}

function clearSentence(){
    sentence = [];
    updateSentenceUI();
}

function playSentence(){

    if(sentence.length === 0){
        alert("No sentence to play");
        return;
    }

    playSequence(sentence);
}


// ================= PLAY SEQUENCE =================
function playSequence(words){

    const video = document.getElementById("signVideo");
    const img = document.getElementById("signImage");

    let i = 0;

    function playNext(){

        if(i >= words.length){
            return;
        }

        let word = words[i].toUpperCase().replace(/ /g,"_");

        console.log("Playing:", word);  // 🔥 debug

        video.pause();
        video.style.display = "none";
        img.style.display = "none";

        const trained = [
            "HELLO","HELP","YES","PLEASE","THANKYOU",
            "STOP","OK","WATER","SORRY","WAIT",
            "GOOD_MORNING","HOW_ARE_YOU","SEE_YOU_LATER"
        ];

        // ✅ VIDEO
        if(trained.includes(word)){

            video.src = "/sign_videos/" + word + ".mp4";

            video.onended = function(){
                i++;
                playNext();
            };

            video.onloadeddata = function(){
                video.play();
            };

            video.style.display = "block";

        }
        // ✅ IMAGE
        else{

            img.src = "/sign_images/" + word + ".JPEG";

            img.onload = function(){
                img.style.display = "block";

                setTimeout(()=>{
                    i++;
                    playNext();
                }, 1200);
            };
        }
    }

    playNext();
}

// ================= SPEECH =================
function startSpeech(){

    showToast("🎤 Listening...");

    let rec = new webkitSpeechRecognition();

    rec.lang = "en-US";

    rec.onresult = function(e){
        let text = e.results[0][0].transcript.toUpperCase();

        sentence.push(text);
        updateSentenceUI();

        socket.emit("chat_message",{room,text});
    };

    rec.start();
}


// ================= TOAST =================
function showToast(msg){

    let t = document.createElement("div");

    t.innerText = msg;

    t.style.position="fixed";
    t.style.bottom="30px";
    t.style.left="50%";
    t.style.transform="translateX(-50%)";
    t.style.background="#22c55e";
    t.style.padding="10px 20px";
    t.style.borderRadius="10px";

    document.body.appendChild(t);

    setTimeout(()=>t.remove(),2000);
}

// ================= MENU =================
function toggleMenu(){
    document.getElementById("sidebar").classList.toggle("active");
    document.getElementById("mainContent").classList.toggle("shift");
}

// ================= EVENTS =================  
socket.on("room_joined", data=>{  
    alert("Joined Room: " + data.room);  
});  
  
socket.on("user_joined", data=>{  
    alert("Another user joined");  
});

function toggleHistory(){

    let box = document.getElementById("historyBox");
    let btn = event.target;

    if(box.style.display === "none"){
        box.style.display = "block";
        btn.innerText = "❌ Hide History";
    } else {
        box.style.display = "none";
        btn.innerText = "📜 Show History";
    }
}

function updateHistoryUI(){

    const box = document.getElementById("historyBox");

    box.innerHTML = "";

    if(history.length === 0){
        box.innerHTML = "<div>No history yet</div>";
        return;
    }

    history.forEach((msg, index)=>{
        box.innerHTML += `
        <div style="
        color:white;
        padding:6px;
        border-bottom:1px solid #334155;
        ">
        ${index+1}. ${msg}
        </div>`;
    });

    console.log("History UI updated:", history); // 🔥 DEBUG
}

function downloadHistory(){

    if(history.length === 0){
        alert("No history");
        return;
    }

    let content = history.join("\n");

    let blob = new Blob([content], { type: "text/plain" });

    let a = document.createElement("a");

    a.href = URL.createObjectURL(blob);
    a.download = "conversation.txt";

    a.click();
}

function clearHistory(){
    history=[];
    updateHistoryUI();
}

function toggleHistory(){

    const box = document.getElementById("historyBox");
    const eye = document.getElementById("eyeBtn");

    if(box.style.display === "none"){

        box.style.display = "block";
        eye.innerText = "👁";   // visible

    } else {

        box.style.display = "none";
        eye.innerText = "🙈";   // hidden
    }
}

function enterApp(){

    const screen = document.getElementById("welcomeScreen");

    screen.style.opacity = "0";
    screen.style.transition = "0.8s";

    setTimeout(()=>{
        screen.style.display = "none";
        document.getElementById("mainContent").style.display = "block";
        startCamera();
    },800);
}

function triggerGlow(){

    const box = document.getElementById("videoContainer");

    box.classList.add("glow");

    setTimeout(()=>{
        box.classList.remove("glow");
    }, 1000);
}

