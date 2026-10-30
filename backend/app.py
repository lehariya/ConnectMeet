import os
import re
import uuid
import sqlite3
import secrets
from datetime import datetime, timezone
from pathlib import Path
from functools import wraps

from dotenv import load_dotenv
from flask import Flask, jsonify, request, g
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room, disconnect

load_dotenv()
ROOT = Path(__file__).resolve().parent
DATABASE_PATH = os.getenv("DATABASE_PATH", str(ROOT / "connectmeet.sqlite3"))
MAX_PARTICIPANTS = max(2, int(os.getenv("MAX_PARTICIPANTS", "4")))
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "development-only-change-me")
CORS(app, resources={r"/api/*": {"origins": FRONTEND_ORIGIN}})
socketio = SocketIO(app, cors_allowed_origins=[FRONTEND_ORIGIN, "http://127.0.0.1:5173"], async_mode="threading")

# Runtime presence is intentionally separate from persistent meeting metadata.
rooms = {}  # room_id -> {host_token, locked, participants: {sid: participant dict}}
sid_rooms = {}  # sid -> room_id


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def db_connection():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    Path(DATABASE_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = db_connection()
    schema = (ROOT / "schema.sql").read_text(encoding="utf-8")
    conn.executescript(schema)
    conn.commit()
    conn.close()


def valid_room_id(room_id):
    return isinstance(room_id, str) and re.fullmatch(r"[a-f0-9]{8}", room_id) is not None


def get_meeting(room_id):
    conn = db_connection()
    row = conn.execute("SELECT * FROM meetings WHERE room_id = ?", (room_id,)).fetchone()
    conn.close()
    return row


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "service": "ConnectMeet API"})


@app.post("/api/rooms")
def create_room():
    payload = request.get_json(silent=True) or {}
    title = str(payload.get("title", "Quick meeting")).strip()[:80] or "Quick meeting"
    room_id = uuid.uuid4().hex[:8]
    host_token = secrets.token_urlsafe(32)
    created_at = utc_now()
    conn = db_connection()
    conn.execute(
        "INSERT INTO meetings (room_id, title, host_token, created_at, locked, ended) VALUES (?, ?, ?, ?, 0, 0)",
        (room_id, title, host_token, created_at),
    )
    conn.commit()
    conn.close()
    rooms[room_id] = {"host_token": host_token, "locked": False, "participants": {}, "title": title}
    return jsonify({"room_id": room_id, "title": title, "host_token": host_token, "created_at": created_at}), 201


@app.get("/api/rooms/<room_id>")
def room_details(room_id):
    if not valid_room_id(room_id):
        return jsonify({"error": "Invalid room ID"}), 400
    meeting = get_meeting(room_id)
    if meeting is None or meeting["ended"]:
        return jsonify({"error": "Meeting not found or already ended"}), 404
    state = rooms.get(room_id, {})
    return jsonify({
        "room_id": meeting["room_id"],
        "title": meeting["title"],
        "created_at": meeting["created_at"],
        "locked": bool(state.get("locked", meeting["locked"])),
        "participant_count": len(state.get("participants", {})),
        "max_participants": MAX_PARTICIPANTS,
    })


def room_for_sid(sid):
    room_id = sid_rooms.get(sid)
    if not room_id:
        return None, None
    return room_id, rooms.get(room_id)


def participant_list(room):
    return [
        {k: p[k] for k in ("id", "name", "is_host", "is_cohost", "audio_enabled", "video_enabled", "hand_raised", "speaking")}
        for p in room["participants"].values()
    ]


def broadcast_participants(room_id):
    room = rooms.get(room_id)
    if room:
        socketio.emit("participants", participant_list(room), to=room_id)


@socketio.on("join-meeting")
def handle_join(data):
    data = data or {}
    room_id = str(data.get("room_id", ""))
    name = str(data.get("name", "")).strip()[:40]
    host_token = str(data.get("host_token", ""))
    if not valid_room_id(room_id) or not name:
        emit("join-error", {"message": "Enter a valid room ID and display name."})
        return
    meeting = get_meeting(room_id)
    if meeting is None or meeting["ended"]:
        emit("join-error", {"message": "This meeting does not exist or has ended."})
        return
    room = rooms.setdefault(room_id, {
        "host_token": meeting["host_token"], "locked": bool(meeting["locked"]),
        "participants": {}, "title": meeting["title"]
    })
    is_host = secrets.compare_digest(host_token, room["host_token"]) if host_token else False
    if room["locked"] and not is_host:
        emit("join-error", {"message": "The host has locked this meeting."})
        return
    if len(room["participants"]) >= MAX_PARTICIPANTS:
        emit("join-error", {"message": f"This demo room is limited to {MAX_PARTICIPANTS} participants."})
        return
    # Avoid duplicate stale membership if a socket retries.
    old_room, _ = room_for_sid(request.sid)
    if old_room:
        leave_room(old_room)
        old = rooms.get(old_room)
        if old:
            old["participants"].pop(request.sid, None)
            broadcast_participants(old_room)
    participant = {
        "id": request.sid, "name": name, "is_host": is_host, "is_cohost": False,
        "audio_enabled": True, "video_enabled": True, "hand_raised": False,
        "speaking": False, "can_chat": True, "can_share": True,
    }
    room["participants"][request.sid] = participant
    sid_rooms[request.sid] = room_id
    join_room(room_id)
    emit("joined", {"self_id": request.sid, "room_id": room_id, "title": room["title"],
                    "is_host": is_host, "participants": participant_list(room),
                    "existing_peer_ids": [sid for sid in room["participants"] if sid != request.sid]})
    emit("peer-joined", {"id": request.sid, "name": name}, to=room_id, include_self=False)
    broadcast_participants(room_id)


@socketio.on("signal")
def handle_signal(data):
    data = data or {}
    room_id, room = room_for_sid(request.sid)
    target = data.get("target")
    if not room_id or not room or target not in room["participants"]:
        return
    # Relay only within the sender's current room.
    emit("signal", {"sender": request.sid, "signal": data.get("signal")}, to=target)


@socketio.on("chat-message")
def handle_chat(data):
    room_id, room = room_for_sid(request.sid)
    if not room_id or not room:
        return
    participant = room["participants"].get(request.sid)
    if not participant or not participant.get("can_chat", True):
        emit("action-error", {"message": "Chat is disabled for you in this meeting."})
        return
    text = str((data or {}).get("text", "")).strip()
    if not text:
        return
    if len(text) > 1000:
        emit("action-error", {"message": "Messages must be 1000 characters or fewer."})
        return
    emit("chat-message", {"id": uuid.uuid4().hex, "sender_id": request.sid,
        "sender": participant["name"], "text": text, "timestamp": utc_now()}, to=room_id)


@socketio.on("participant-status")
def participant_status(data):
    room_id, room = room_for_sid(request.sid)
    if not room_id or not room:
        return
    p = room["participants"].get(request.sid)
    if not p:
        return
    data = data or {}
    for field in ("audio_enabled", "video_enabled", "hand_raised", "speaking"):
        if field in data:
            p[field] = bool(data[field])
    broadcast_participants(room_id)


@socketio.on("host-action")
def host_action(data):
    room_id, room = room_for_sid(request.sid)
    if not room_id or not room:
        emit("action-error", {"message": "You are not in a meeting."})
        return
    actor = room["participants"].get(request.sid)
    if not actor or not (actor["is_host"] or actor["is_cohost"]):
        emit("action-error", {"message": "Only the host or a co-host can do that."})
        return
    data = data or {}
    action = data.get("action")
    target = data.get("target")
    if action in ("lock", "unlock"):
        room["locked"] = action == "lock"
        conn = db_connection()
        conn.execute("UPDATE meetings SET locked = ? WHERE room_id = ?", (int(room["locked"]), room_id))
        conn.commit()
        conn.close()
        socketio.emit("room-lock", {"locked": room["locked"]}, to=room_id)
        return
    if action == "end":
        socketio.emit("meeting-ended", {"message": "The host ended this meeting."}, to=room_id)
        conn = db_connection()
        conn.execute("UPDATE meetings SET ended = 1 WHERE room_id = ?", (room_id,))
        conn.commit()
        conn.close()
        for sid in list(room["participants"]):
            sid_rooms.pop(sid, None)
        rooms.pop(room_id, None)
        return
    if target not in room["participants"]:
        emit("action-error", {"message": "Participant not found."})
        return
    target_p = room["participants"][target]
    if target_p["is_host"]:
        emit("action-error", {"message": "The host cannot be moderated by another participant."})
        return
    if action == "remove":
        socketio.emit("removed", {"message": "The host removed you from the meeting."}, to=target)
        room["participants"].pop(target, None)
        sid_rooms.pop(target, None)
        socketio.emit("force-leave", {}, to=target)
        broadcast_participants(room_id)
    elif action == "cohost":
        target_p["is_cohost"] = True
        broadcast_participants(room_id)
    elif action == "mute":
        socketio.emit("mute-request", {"message": "The host requests that you mute your microphone."}, to=target)
    elif action == "toggle-chat":
        target_p["can_chat"] = not target_p.get("can_chat", True)
        socketio.emit("permission-update", {"can_chat": target_p["can_chat"], "can_share": target_p["can_share"]}, to=target)
    elif action == "toggle-share":
        target_p["can_share"] = not target_p.get("can_share", True)
        socketio.emit("permission-update", {"can_chat": target_p["can_chat"], "can_share": target_p["can_share"]}, to=target)
    else:
        emit("action-error", {"message": "Unknown moderation action."})


@socketio.on("disconnect")
def on_disconnect(reason=None):
    room_id, room = room_for_sid(request.sid)
    if not room_id or not room:
        sid_rooms.pop(request.sid, None)
        return
    room["participants"].pop(request.sid, None)
    sid_rooms.pop(request.sid, None)
    emit("peer-left", {"id": request.sid}, to=room_id, include_self=False)
    broadcast_participants(room_id)
    # Keep meeting metadata and room settings so users can reconnect.


@app.errorhandler(500)
def internal_error(_error):
    return jsonify({"error": "An unexpected server error occurred."}), 500


if __name__ == "__main__":
    init_db()
    socketio.run(app, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")), debug=False, allow_unsafe_werkzeug=True)
