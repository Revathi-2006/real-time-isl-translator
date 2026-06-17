from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import os
import base64
import numpy as np
import cv2
import time
from collections import deque, defaultdict

import joblib
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

app = Flask(__name__, static_folder="frontend")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# ================= SETTINGS =================

STATIC_CONF = 0.35
DYNAMIC_CONF = 0.10

SEQUENCE_LENGTH = 15
STABLE_REQUIRED = 3
COOLDOWN_SECONDS = 2

# ================= LOAD MODELS =================

static_model = joblib.load("ml/word_classifier.pkl")
static_scaler = joblib.load("ml/word_scaler.pkl")

dynamic_model = joblib.load("ml/dynamic_classifier.pkl")
static_classes = np.load("ml/word_classes.npy", allow_pickle=True)
dynamic_scaler = joblib.load("ml/dynamic_scaler.pkl")
dynamic_classes = np.load("ml/dynamic_classes.npy", allow_pickle=True)

# ================= HAND MODEL =================

MODEL_PATH = "ml/hand_landmarker.task"

base_options = python.BaseOptions(model_asset_path=MODEL_PATH)

options = vision.HandLandmarkerOptions(
    base_options=base_options,
    num_hands=2
)

detector = vision.HandLandmarker.create_from_options(options)

# ================= CLIENT STATE =================

client_sequences = {}
client_dynamic_buffer = defaultdict(lambda: deque(maxlen=STABLE_REQUIRED))
client_motion_history = defaultdict(lambda: deque(maxlen=10))

client_last_time = {}
client_rooms = {}
client_modes = {}
client_last_prediction = {}

# ================= ROUTES =================

@app.route("/")
def index():
    return send_from_directory("frontend", "index.html")

@app.route("/<path:path>")
def static_files(path):
    return send_from_directory("frontend", path)

@app.route('/sign_videos/<path:filename>')
def serve_sign_videos(filename):
    return send_from_directory("frontend/sign_videos", filename)

@app.route('/sign_images/<path:filename>')
def serve_sign_images(filename):
    return send_from_directory("frontend/sign_images", filename)

# ================= ROOM =================

@socketio.on("join_room")
def handle_join(data):

    room = data.get("room")
    join_room(room)

    sid = request.sid

    client_rooms[sid] = room
    client_sequences[sid] = deque(maxlen=SEQUENCE_LENGTH)
    client_last_time[sid] = 0
    client_modes[sid] = "STATIC"
    client_last_prediction[sid] = ""

    emit("room_joined", {"room": room})
    emit("user_joined", {"msg": "Another user joined"}, room=room, include_self=False)

# ================= DISCONNECT =================

@socketio.on("disconnect")
def handle_disconnect():

    sid = request.sid

    room = client_rooms.get(sid)

    if room:
        leave_room(room)

    client_sequences.pop(sid, None)
    client_dynamic_buffer.pop(sid, None)
    client_motion_history.pop(sid, None)
    client_last_time.pop(sid, None)
    client_rooms.pop(sid, None)
    client_modes.pop(sid, None)
    client_last_prediction.pop(sid, None)

# ================= MODE =================

@socketio.on("set_mode")
def handle_mode(data):

    sid = request.sid
    mode = data.get("mode", "STATIC")

    client_modes[sid] = mode

    client_sequences[sid].clear()
    client_dynamic_buffer[sid].clear()
    client_motion_history[sid].clear()

# ================= CHAT =================

@socketio.on("chat_message")
def handle_chat(data):

    room = data.get("room")
    text = data.get("text")
    sid = request.sid

    socketio.emit("chat_message", {
        "text": text,
        "sender": sid
    }, room=room)

# ================= VIDEO FRAME =================

@socketio.on("video_frame")
def handle_video_frame(data):

    sid = request.sid
    room = client_rooms.get(sid)

    if not room:
        return

    socketio.emit("remote_frame", data, room=room, include_self=False)

    mode = client_modes.get(sid, "STATIC")

    img_data = base64.b64decode(data.split(',')[1])
    np_arr = np.frombuffer(img_data, np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    mp_image = mp.Image(
        image_format=mp.ImageFormat.SRGB,
        data=frame_rgb
    )

    result = detector.detect(mp_image)

    detected_word = ""

    # ================= LANDMARK PROCESS =================

    if result.hand_landmarks:

        hands = result.hand_landmarks

        if len(hands) == 2:
            if np.mean([lm.x for lm in hands[0]]) > np.mean([lm.x for lm in hands[1]]):
                hands = [hands[1], hands[0]]

        landmarks = []

        # ===== MOTION TRACKING =====
        if len(hands) > 0:
            wrist = hands[0][0]

            current_pos = np.array([wrist.x, wrist.y])
            client_motion_history[sid].append(current_pos)

            motion_score = 0

            if len(client_motion_history[sid]) >= 2:
                diffs = [
                    np.linalg.norm(
                        client_motion_history[sid][i] - client_motion_history[sid][i-1]
                    )
                    for i in range(1, len(client_motion_history[sid]))
                ]
                motion_score = np.mean(diffs)
        else:
            motion_score = 0

        for hand in hands[:2]:
            wrist = hand[0]
            for lm in hand:
                landmarks.extend([
                    lm.x - wrist.x,
                    lm.y - wrist.y,
                    lm.z - wrist.z
                ])

        if len(landmarks) == 63:
            landmarks.extend([0.0] * 63)

        if len(landmarks) == 126:

            # ================= STATIC =================
            if mode == "STATIC":

                lm = np.array(landmarks, dtype=np.float32)

                max_val = np.max(np.abs(lm))
                if max_val != 0:
                    lm = lm / max_val

                X = static_scaler.transform(lm.reshape(1, -1))
                proba = static_model.predict_proba(X)[0]

                idx = np.argmax(proba)
                conf = proba[idx]

                if conf > STATIC_CONF:

                    pred_word = static_classes[idx]
                    client_dynamic_buffer[sid].append(pred_word)

                    if len(client_dynamic_buffer[sid]) == STABLE_REQUIRED:
                        if len(set(client_dynamic_buffer[sid])) == 1:
                            detected_word = pred_word

            # ================= DYNAMIC =================
            elif mode == "DYNAMIC":

                client_sequences[sid].append(landmarks)

                if len(client_sequences[sid]) == SEQUENCE_LENGTH:

                    try:
                        seq = np.array(client_sequences[sid]).flatten().reshape(1, -1)
                        seq = dynamic_scaler.transform(seq)

                        proba_dyn = dynamic_model.predict_proba(seq)[0]

                        idx_dyn = np.argmax(proba_dyn)
                        conf_dyn = proba_dyn[idx_dyn]

                        if conf_dyn > DYNAMIC_CONF:

                            pred_word = dynamic_classes[idx_dyn]
                            client_dynamic_buffer[sid].append(pred_word)

                            if len(client_dynamic_buffer[sid]) == STABLE_REQUIRED:
                                if len(set(client_dynamic_buffer[sid])) == 1:
                                    detected_word = pred_word

                                    client_sequences[sid].clear()
                                    client_dynamic_buffer[sid].clear()

                    except:
                        pass

                # ===== MOTION FALLBACK =====
                now = time.time()

                if now - client_last_time[sid] > COOLDOWN_SECONDS:

                    if motion_score > 0.05:
                        detected_word = "GOOD_MORNING"

                    elif motion_score > 0.03:
                        detected_word = "HOW_ARE_YOU"

                    elif motion_score > 0.01:
                        detected_word = "SEE_YOU_LATER"

                    if detected_word != "":
                        client_last_time[sid] = now
                        client_sequences[sid].clear()
                        client_dynamic_buffer[sid].clear()

    else:
        client_sequences[sid].clear()

    # ================= FINAL FILTER =================

    now = time.time()

    if detected_word != "" and now - client_last_time[sid] > COOLDOWN_SECONDS:

        last = client_last_prediction.get(sid, "")

        if detected_word != last:

            socketio.emit("chat_message", {
                "text": detected_word,
                "sender": sid
            }, room=room)

            client_last_prediction[sid] = detected_word
            client_last_time[sid] = now

            client_dynamic_buffer[sid].clear()

# ================= RUN =================

if __name__ == "__main__":

    print("Server running at http://localhost:5000")
    socketio.run(
    app,
    host="0.0.0.0",
    port=int(os.environ.get("PORT", 5000))
)