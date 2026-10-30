# Feature status

## Implemented in source
- Create room via REST API and join by room ID / URL.
- Room metadata persistence in SQLite.
- Browser media capture with echo cancellation/noise suppression constraints where supported.
- WebRTC mesh offers, answers, ICE candidate relay through Socket.IO.
- Mute/unmute and camera enable/disable.
- Screen share with sender track replacement and restoration.
- Camera selection when multiple video inputs are available.
- Real-time presence, basic speaking-status data field, raised hand.
- In-call text chat and emoji insertion.
- Host/co-host moderation actions: lock/unlock, remove participant, mute request, promote co-host, toggle participant chat permission.
- Meeting end event, participant capacity limit, API validation, visible errors.
- API unit tests.

## Partial / limitations
- The UI displays a speaking indicator only when the server-side `speaking` status is set; automatic audio-level detection is not implemented.
- The UI reports peer connection state at a basic level, not a robust network quality score.
- Chat permission toggling is enforced server-side. Screen-share permission is checked by the client; this is not a security boundary because the browser is controlled by the participant.
- Refresh/reconnect can reconnect the Socket.IO transport, but the participant must rejoin the room and media session; full seamless session restoration is not implemented.
- Host tokens are kept in client state for the current session and are not a production authentication system.
- Co-host can perform host actions but cannot assign co-host status to another participant through the UI; the server currently permits host/co-host moderation actions.
- File sharing, recording, audited E2EE, TURN provisioning, and an SFU are not implemented.
