# ConnectMeet — Full-Stack Video Conferencing

ConnectMeet is a learning-focused video-conferencing application built with React, Flask, Flask-SocketIO, WebRTC, and SQLite.

## Features
- Create a meeting and share its room ID / URL.
- Join a room with a display name.
- Browser audio/video capture, mute, camera toggle, and camera device selection.
- One-to-one and small-group calls using WebRTC mesh connections.
- Real-time participant presence and basic speaking indicator.
- In-call text chat and emoji-friendly messages.
- Host actions: remove a participant, lock/unlock the room, mute request, and promote a co-host.
- Meeting metadata stored in SQLite.
- Reconnection-friendly signaling and clear media permission errors.
- Responsive UI, API tests, and configuration examples.

## Important scope and security notes
This is an educational portfolio implementation, not a hardened production meeting service.
- WebRTC mesh bandwidth grows quickly as participants increase. Keep demos small (suggested maximum: 4 participants). A production service should use an SFU such as mediasoup, LiveKit, or Janus.
- For connectivity across restrictive NATs, configure a TURN server. Public STUN alone is not enough for every network.
- Browser WebRTC encrypts media in transit with DTLS-SRTP, but this project does **not** implement a separate, audited end-to-end encryption layer or server-blind key management.
- Recording, file transfer, background noise suppression, adaptive bitrate policies, and full device hot-swapping are not implemented. Browser echo cancellation/noise suppression are requested where supported.
- The demo host token is a room capability, not full user authentication. Do not expose this app publicly without proper identity, authorization, rate limiting, HTTPS/WSS, and security review.
- Socket.IO's development server is used. For production, use a supported deployment setup and a message queue if scaling across workers.

## Requirements
- Python 3.10+
- Node.js 18+
- A modern browser (Chrome/Edge/Firefox/Safari)
- Microphone/camera permission
- `localhost` is treated as a secure context by browsers. For access from other devices, use HTTPS.

## Setup

### 1. Backend
```bash
cd backend
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
# macOS/Linux:
source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env  # Windows; use `cp .env.example .env` on macOS/Linux
python app.py
```
Backend: `http://127.0.0.1:5000`

### 2. Frontend (new terminal)
```bash
cd frontend
npm install
copy .env.example .env  # Windows; use `cp .env.example .env` on macOS/Linux
npm run dev
```
Frontend: `http://localhost:5173`

### 3. Try a call
1. Open `http://localhost:5173`.
2. Create a meeting and copy the room link.
3. Open the link in another browser window or device and join with another name.
4. Allow microphone/camera permissions.
5. Test mute, camera, chat, participant list, and host controls.

For calls between separate devices or networks, configure ICE servers in `frontend/src/webrtc.js` and serve the frontend over HTTPS.

## Environment variables
Backend `.env`:
- `SECRET_KEY`: Flask session/signing secret for local development.
- `DATABASE_PATH`: optional SQLite path.
- `FRONTEND_ORIGIN`: frontend origin used for CORS.
- `MAX_PARTICIPANTS`: room capacity (default 4).
- `HOST`: bind address (default 127.0.0.1).
- `PORT`: port (default 5000).

Frontend `.env`:
- `VITE_API_URL`: backend base URL.
- `VITE_SOCKET_URL`: Socket.IO server URL.

## Tests
```bash
cd backend
python -m unittest discover -s tests -v
```
The API tests use Flask's test client and a temporary SQLite database. They do not test real browser media devices or multi-network WebRTC connectivity.

## Architecture
- `frontend/src/App.jsx`: pages, call UI, state, Socket.IO event handlers and controls.
- `frontend/src/webrtc.js`: peer-connection creation, offer/answer and ICE candidate handling.
- `backend/app.py`: REST endpoints, database schema, room state and Socket.IO signaling/chat/moderation.
- `backend/tests/test_api.py`: room API tests.
- `backend/schema.sql`: persistent meeting metadata schema.

## Interview honesty
When discussing this project, distinguish implemented functionality from production extensions. The project uses WebRTC's built-in encrypted media transport, but does not claim independently audited end-to-end encryption. It has a small-group mesh architecture, not a scalable SFU architecture.
