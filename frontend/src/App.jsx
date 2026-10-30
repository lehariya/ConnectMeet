import React, { useCallback, useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import {
  Video, VideoOff, Mic, MicOff, MonitorUp, PhoneOff, MessageCircle,
  Users, Hand, Copy, Plus, Link2, Shield, Settings, Send, X, Camera,
  Lock, Unlock, LogOut, Check, AlertCircle, Wifi, Volume2, Smile
} from 'lucide-react'
import { createPeerConnection, makeOffer, handleSignal } from './webrtc.js'

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:5000'
const SOCKET = import.meta.env.VITE_SOCKET_URL || API

function getRoomFromUrl() {
  return new URLSearchParams(window.location.search).get('room') || ''
}

function VideoTile({ participant, stream, self, muted }) {
  const videoRef = useRef(null)
  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream
  }, [stream])
  return <div className={`video-tile ${self ? 'self-tile' : ''}`}>
    {stream && participant.video_enabled
      ? <video ref={videoRef} autoPlay playsInline muted={muted} />
      : <div className="avatar">{(participant.name || '?').slice(0, 1).toUpperCase()}</div>}
    <div className="tile-label">
      <span>{participant.name}{self ? ' (You)' : ''}{participant.is_host ? ' · Host' : participant.is_cohost ? ' · Co-host' : ''}</span>
      <span className="tile-status">{participant.audio_enabled ? <Mic size={14}/> : <MicOff size={14}/>} {participant.hand_raised ? <Hand size={14} className="hand-raised"/> : null}</span>
    </div>
    {participant.speaking && <div className="speaking-ring" aria-label="Speaking"/>}
  </div>
}

export default function App() {
  const [roomInput, setRoomInput] = useState(getRoomFromUrl())
  const [name, setName] = useState('')
  const [title, setTitle] = useState('Quick meeting')
  const [meeting, setMeeting] = useState(null)
  const [selfId, setSelfId] = useState('')
  const [participants, setParticipants] = useState([])
  const [remoteStreams, setRemoteStreams] = useState({})
  const [localStream, setLocalStream] = useState(null)
  const [audioOn, setAudioOn] = useState(true)
  const [videoOn, setVideoOn] = useState(true)
  const [chatOpen, setChatOpen] = useState(false)
  const [peopleOpen, setPeopleOpen] = useState(true)
  const [messages, setMessages] = useState([])
  const [messageInput, setMessageInput] = useState('')
  const [socketReady, setSocketReady] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [locked, setLocked] = useState(false)
  const [canChat, setCanChat] = useState(true)
  const [canShare, setCanShare] = useState(true)
  const [shareStream, setShareStream] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [cameraDevices, setCameraDevices] = useState([])
  const socketRef = useRef(null)
  const peersRef = useRef({})
  const localStreamRef = useRef(null)
  const localVideoRef = useRef(null)
  const timerRef = useRef(null)
  const isHostRef = useRef(false)
  const joiningRef = useRef(false)

  const isHost = Boolean(meeting?.is_host)
  const roomId = meeting?.room_id

  const showNotice = useCallback((text) => {
    setNotice(text)
    window.setTimeout(() => setNotice(''), 3200)
  }, [])

  const cleanupMedia = useCallback(() => {
    Object.values(peersRef.current).forEach(pc => pc.close())
    peersRef.current = {}
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(track => track.stop())
    if (shareStream) shareStream.getTracks().forEach(track => track.stop())
    localStreamRef.current = null
    setLocalStream(null)
    setRemoteStreams({})
    setShareStream(null)
    if (timerRef.current) window.clearInterval(timerRef.current)
  }, [shareStream])

  const leaveMeeting = useCallback((endedByHost = false) => {
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }
    cleanupMedia()
    setMeeting(null)
    setParticipants([])
    setMessages([])
    setSelfId('')
    setElapsed(0)
    joiningRef.current = false
    if (endedByHost) showNotice('The host ended this meeting.')
  }, [cleanupMedia, showNotice])

  useEffect(() => () => {
    if (socketRef.current) socketRef.current.disconnect()
    Object.values(peersRef.current).forEach(pc => pc.close())
    localStreamRef.current?.getTracks().forEach(track => track.stop())
  }, [])

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream
  }, [localStream])

  useEffect(() => {
    if (!meeting) return
    timerRef.current = window.setInterval(() => setElapsed(s => s + 1), 1000)
    return () => window.clearInterval(timerRef.current)
  }, [meeting?.room_id])

  const getMedia = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera/microphone access requires HTTPS or localhost and a supported browser.')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      localStreamRef.current = stream
      setLocalStream(stream)
      setAudioOn(true); setVideoOn(true)
      const devices = await navigator.mediaDevices.enumerateDevices()
      setCameraDevices(devices.filter(device => device.kind === 'videoinput'))
      return stream
    } catch (e) {
      setError(e.name === 'NotAllowedError'
        ? 'Camera or microphone permission was denied. Allow access in your browser settings, then rejoin.'
        : `Could not access your camera/microphone: ${e.message}`)
      throw e
    }
  }

  const sendSignal = useCallback((target, signal) => {
    socketRef.current?.emit('signal', { target, signal })
  }, [])

  const setupPeer = useCallback((peerId, shouldOffer, stream) => {
    if (peersRef.current[peerId]) return peersRef.current[peerId]
    const pc = createPeerConnection({
      peerId, localStream: stream, sendSignal,
      onRemoteStream: (id, remote) => setRemoteStreams(prev => ({ ...prev, [id]: remote })),
      onConnectionState: (id, state) => {
        if (state === 'failed') showNotice('A peer connection failed. Check network or TURN configuration.')
      }
    })
    peersRef.current[peerId] = pc
    if (shouldOffer) makeOffer(pc, peerId, sendSignal).catch(e => setError(`Could not start peer connection: ${e.message}`))
    return pc
  }, [sendSignal, showNotice])

  const joinRoom = async (roomIdToJoin, hostToken = '') => {
    if (!name.trim()) { setError('Please enter your display name first.'); return }
    if (joiningRef.current) return
    joiningRef.current = true
    setError('')
    let stream
    try { stream = await getMedia() } catch { joiningRef.current = false; return }
    const socket = io(SOCKET, { transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: 8 })
    socketRef.current = socket
    socket.on('connect', () => {
      setSocketReady(true)
      socket.emit('join-meeting', { room_id: roomIdToJoin, name: name.trim(), host_token: hostToken })
    })
    socket.on('connect_error', () => setError('Cannot connect to the server. Make sure the Flask backend is running.'))
    socket.on('disconnect', () => setSocketReady(false))
    socket.on('join-error', data => {
      setError(data.message || 'Could not join this meeting.')
      joiningRef.current = false
      cleanupMedia()
      socket.disconnect()
    })
    socket.on('joined', data => {
      setMeeting({ room_id: data.room_id, title: data.title, is_host: data.is_host, host_token: hostToken })
      isHostRef.current = data.is_host
      setSelfId(data.self_id)
      setParticipants(data.participants || [])
      setRoomInput(data.room_id)
      setLocked(false)
      window.history.replaceState({}, '', `?room=${data.room_id}`)
      joiningRef.current = false
      data.existing_peer_ids.forEach(peerId => setupPeer(peerId, true, stream))
    })
    socket.on('peer-joined', data => {
      // The newly joining peer initiates the offer to avoid offer glare.
      showNotice(`${data.name} joined the meeting.`)
    })
    socket.on('signal', async data => {
      try {
        const pc = setupPeer(data.sender, false, localStreamRef.current)
        await handleSignal(pc, data.signal, data.sender, sendSignal)
      } catch (e) { console.warn('Signaling error', e) }
    })
    socket.on('peer-left', data => {
      peersRef.current[data.id]?.close()
      delete peersRef.current[data.id]
      setRemoteStreams(prev => { const next = { ...prev }; delete next[data.id]; return next })
      showNotice('A participant left the meeting.')
    })
    socket.on('participants', setParticipants)
    socket.on('chat-message', msg => setMessages(prev => [...prev, msg]))
    socket.on('room-lock', data => setLocked(data.locked))
    socket.on('meeting-ended', () => leaveMeeting(true))
    socket.on('removed', data => { setError(data.message); leaveMeeting(false) })
    socket.on('force-leave', () => leaveMeeting(false))
    socket.on('action-error', data => showNotice(data.message))
    socket.on('permission-update', data => { setCanChat(data.can_chat); setCanShare(data.can_share) })
    socket.on('mute-request', () => showNotice('The host requests that you mute your microphone.'))
  }

  const createMeeting = async () => {
    if (!name.trim()) { setError('Enter your name before creating a meeting.'); return }
    try {
      const response = await fetch(`${API}/api/rooms`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() || 'Quick meeting' })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not create meeting')
      setRoomInput(data.room_id)
      await joinRoom(data.room_id, data.host_token)
    } catch (e) { setError(`Could not create meeting: ${e.message}`) }
  }

  const toggleAudio = () => {
    const next = !audioOn
    localStreamRef.current?.getAudioTracks().forEach(track => { track.enabled = next })
    setAudioOn(next)
    socketRef.current?.emit('participant-status', { audio_enabled: next })
  }
  const toggleVideo = () => {
    const next = !videoOn
    localStreamRef.current?.getVideoTracks().forEach(track => { track.enabled = next })
    setVideoOn(next)
    socketRef.current?.emit('participant-status', { video_enabled: next })
  }
  const raiseHand = () => {
    const me = participants.find(p => p.id === selfId)
    socketRef.current?.emit('participant-status', { hand_raised: !me?.hand_raised })
  }
  const sendChat = (event) => {
    event.preventDefault()
    if (!messageInput.trim() || !canChat) return
    socketRef.current?.emit('chat-message', { text: messageInput.trim() })
    setMessageInput('')
  }
  const hostAction = (action, target = null) => socketRef.current?.emit('host-action', { action, target })
  const copyLink = async () => {
    const link = `${window.location.origin}/?room=${roomId || roomInput}`
    try { await navigator.clipboard.writeText(link); showNotice('Meeting link copied!') }
    catch { showNotice(`Share this meeting ID: ${roomId || roomInput}`) }
  }
  const shareScreen = async () => {
    if (!canShare) { showNotice('Screen sharing is disabled for your account in this meeting.'); return }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true })
      const screenTrack = stream.getVideoTracks()[0]
      Object.values(peersRef.current).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video')
        if (sender) sender.replaceTrack(screenTrack)
      })
      setShareStream(stream)
      screenTrack.onended = async () => {
        const cameraTrack = localStreamRef.current?.getVideoTracks()[0]
        Object.values(peersRef.current).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video')
          if (sender && cameraTrack) sender.replaceTrack(cameraTrack)
        })
        setShareStream(null)
      }
    } catch (e) { if (e.name !== 'NotAllowedError') showNotice(`Screen sharing failed: ${e.message}`) }
  }
  const switchCamera = async (deviceId) => {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } }, audio: false })
      const newTrack = newStream.getVideoTracks()[0]
      const oldTrack = localStreamRef.current?.getVideoTracks()[0]
      Object.values(peersRef.current).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video')
        if (sender) sender.replaceTrack(newTrack)
      })
      if (oldTrack) { localStreamRef.current.removeTrack(oldTrack); oldTrack.stop() }
      localStreamRef.current.addTrack(newTrack)
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
      setVideoOn(true)
    } catch (e) { showNotice(`Could not switch camera: ${e.message}`) }
  }
  const formatTime = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`

  if (!meeting) return <main className="landing">
    <header className="topbar"><div className="brand"><span className="brand-icon"><Video size={21}/></span>Connect<span>Meet</span></div><span className="secure-label"><Shield size={14}/> Browser-based meetings</span></header>
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><span className="live-dot"/> SIMPLE. CLEAR. CONNECTED.</div>
        <h1>Make space for<br/><span>great conversations.</span></h1>
        <p>Bring your team together with easy-to-join video meetings, live chat, and thoughtful meeting controls.</p>
        <div className="hero-points"><span><Check size={16}/> One link to join</span><span><Check size={16}/> Audio & video controls</span><span><Check size={16}/> Host moderation</span></div>
      </div>
      <div className="join-card">
        <div className="card-heading"><div><h2>Start connecting</h2><p>Create a room or join an existing meeting.</p></div><div className="card-symbol"><Video size={22}/></div></div>
        <label>Your display name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Lehariya" maxLength={40}/>
        <label>Meeting title <span className="optional">Optional</span></label><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Project sync"/>
        <button className="primary-btn" onClick={createMeeting}><Plus size={18}/> Create a new meeting</button>
        <div className="or-divider"><span/>or join with a link<span/></div>
        <label>Meeting ID</label><div className="join-row"><input value={roomInput} onChange={e => setRoomInput(e.target.value)} placeholder="Enter 8-character room ID" maxLength={8}/><button className="secondary-btn" onClick={() => joinRoom(roomInput)}><Link2 size={17}/> Join</button></div>
        {error && <div className="error-box"><AlertCircle size={16}/>{error}</div>}
        <p className="privacy-note"><Shield size={14}/> Your browser will ask permission before using your camera and microphone.</p>
      </div>
    </section>
    <footer className="landing-footer"><span>ConnectMeet · Full-stack learning project</span><span>WebRTC · React · Flask</span></footer>
  </main>

  return <main className="meeting-app">
    <header className="meeting-header">
      <div className="brand"><span className="brand-icon"><Video size={19}/></span>Connect<span>Meet</span></div>
      <div className="meeting-title"><strong>{meeting.title}</strong><span><span className={`status-dot ${socketReady ? 'online' : ''}`}/>{socketReady ? 'Connected' : 'Reconnecting…'} · {formatTime(elapsed)}</span></div>
      <div className="header-actions"><button className="icon-button" title="Copy meeting link" onClick={copyLink}><Copy size={17}/></button><span className="room-badge">Room {roomId}</span></div>
    </header>
    <div className="meeting-layout">
      <section className="call-area">
        <div className="call-topline"><div><span className="live-dot"/> LIVE MEETING <span className="subtle">· {participants.length} participant{participants.length !== 1 ? 's' : ''}</span></div><div className="quality"><Wifi size={15}/> Peer connection</div></div>
        <div className={`video-grid count-${Math.min(participants.length, 4)}`}>
          {participants.map(p => <VideoTile key={p.id} participant={p.id === selfId ? {...p, audio_enabled: audioOn, video_enabled: videoOn} : p}
            stream={p.id === selfId ? localStream : remoteStreams[p.id]} self={p.id === selfId} muted={p.id === selfId}/>)}
          {participants.length === 0 && <div className="waiting"><Users size={35}/><h3>Waiting for others to join</h3><p>Share your meeting link to invite participants.</p><button className="secondary-btn" onClick={copyLink}><Copy size={16}/> Copy invite link</button></div>}
        </div>
        <div className="call-toolbar">
          <div className="toolbar-left"><span className="call-time">{formatTime(elapsed)}</span><span className="toolbar-separator"/></div>
          <div className="toolbar-controls">
            <button className={`control-btn ${!audioOn ? 'control-off' : ''}`} onClick={toggleAudio}><span>{audioOn ? <Mic size={20}/> : <MicOff size={20}/>}</span><small>{audioOn ? 'Mute' : 'Unmute'}</small></button>
            <button className={`control-btn ${!videoOn ? 'control-off' : ''}`} onClick={toggleVideo}><span>{videoOn ? <Video size={20}/> : <VideoOff size={20}/>}</span><small>{videoOn ? 'Camera' : 'Camera off'}</small></button>
            <button className="control-btn" onClick={shareScreen}><span><MonitorUp size={20}/></span><small>Share screen</small></button>
            <button className={`control-btn ${participants.find(p => p.id === selfId)?.hand_raised ? 'control-active' : ''}`} onClick={raiseHand}><span><Hand size={20}/></span><small>Raise hand</small></button>
            <button className={`control-btn ${chatOpen ? 'control-active' : ''}`} onClick={() => { setChatOpen(v => !v); setPeopleOpen(false) }}><span><MessageCircle size={20}/></span><small>Chat</small></button>
            <button className={`control-btn ${peopleOpen ? 'control-active' : ''}`} onClick={() => { setPeopleOpen(v => !v); setChatOpen(false) }}><span><Users size={20}/></span><small>People</small></button>
            {cameraDevices.length > 1 && <label className="control-btn camera-select"><span><Camera size={20}/></span><small>Camera</small><select aria-label="Switch camera" onChange={e => switchCamera(e.target.value)} defaultValue=""><option value="" disabled>Switch</option>{cameraDevices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}</select></label>}
          </div>
          <div className="toolbar-right"><button className="leave-btn" onClick={() => isHost ? hostAction('end') : leaveMeeting()}><PhoneOff size={18}/><span>{isHost ? 'End' : 'Leave'}</span></button></div>
        </div>
      </section>
      {(chatOpen || peopleOpen) && <aside className="side-panel">
        <div className="panel-heading"><div><h3>{chatOpen ? 'In-call messages' : 'People'}</h3><p>{chatOpen ? 'Send a message to everyone' : `${participants.length} in this meeting`}</p></div><button className="icon-button" onClick={() => { setChatOpen(false); setPeopleOpen(false) }}><X size={18}/></button></div>
        {chatOpen ? <><div className="chat-messages">{messages.length === 0 && <div className="chat-empty"><MessageCircle size={26}/><p>No messages yet</p><span>Start the conversation.</span></div>}{messages.map(msg => <div className={`message ${msg.sender_id === selfId ? 'own-message' : ''}`} key={msg.id}><strong>{msg.sender}</strong><p>{msg.text}</p><time>{new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</time></div>)}</div><form className="chat-form" onSubmit={sendChat}><input disabled={!canChat} value={messageInput} onChange={e => setMessageInput(e.target.value)} placeholder={canChat ? 'Write a message…' : 'Chat disabled by host'}/><button disabled={!canChat || !messageInput.trim()} aria-label="Send message"><Send size={17}/></button></form><div className="emoji-row">{['😊','👍','🎉','❤️','👏'].map(emoji => <button key={emoji} onClick={() => setMessageInput(v => v + emoji)}>{emoji}</button>)}</div></>
        : <><div className="people-list">{participants.map(p => <div className="person-row" key={p.id}><div className="person-avatar">{p.name.slice(0,1).toUpperCase()}</div><div className="person-info"><strong>{p.name}{p.id === selfId ? ' (You)' : ''}</strong><span>{p.is_host ? 'Meeting host' : p.is_cohost ? 'Co-host' : 'Participant'}</span></div><div className="person-icons">{p.audio_enabled ? <Mic size={15}/> : <MicOff size={15}/>} {p.video_enabled ? <Video size={15}/> : <VideoOff size={15}/>} {p.hand_raised ? <Hand size={15} className="hand-raised"/> : null}</div>
          {isHost && p.id !== selfId && <div className="person-menu"><button title="Mute request" onClick={() => hostAction('mute', p.id)}><MicOff size={14}/></button><button title="Promote co-host" onClick={() => hostAction('cohost', p.id)}><Shield size={14}/></button><button title="Remove participant" onClick={() => hostAction('remove', p.id)}><LogOut size={14}/></button><button title="Toggle chat permission" onClick={() => hostAction('toggle-chat', p.id)}><MessageCircle size={14}/></button></div>}
        </div>)}</div>
        {isHost && <div className="host-tools"><div className="host-tools-title"><Shield size={15}/> Host controls</div><button onClick={() => hostAction(locked ? 'unlock' : 'lock')} className="host-action">{locked ? <Unlock size={16}/> : <Lock size={16}/>} {locked ? 'Unlock meeting' : 'Lock meeting'}</button><p>Locking prevents new participants from joining. Use participant actions to manage the room.</p></div>}
        <button className="invite-button" onClick={copyLink}><Copy size={16}/> Copy invite link</button>
        </>}
      </aside>}
    </div>
    {error && <div className="toast error-toast"><AlertCircle size={16}/>{error}<button onClick={() => setError('')}><X size={15}/></button></div>}
    {notice && <div className="toast"><Check size={16}/>{notice}</div>}
    <footer className="meeting-footer"><span><Shield size={13}/> WebRTC encrypted media transport</span><span>{locked ? <><Lock size={13}/> Meeting locked</> : <><Volume2 size={13}/> Noise suppression requested where supported</>}</span></footer>
  </main>
}
