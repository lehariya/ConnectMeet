const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  // For production, add your authenticated TURN service here.
]

export function createPeerConnection({ peerId, localStream, sendSignal, onRemoteStream, onConnectionState }) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  const remoteStream = new MediaStream()

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream))
  }

  pc.ontrack = event => {
    event.streams[0]?.getTracks().forEach(track => {
      if (!remoteStream.getTracks().some(existing => existing.id === track.id)) remoteStream.addTrack(track)
    })
    onRemoteStream(peerId, remoteStream)
  }
  pc.onicecandidate = event => {
    if (event.candidate) sendSignal(peerId, { candidate: event.candidate })
  }
  pc.onconnectionstatechange = () => onConnectionState(peerId, pc.connectionState)
  return pc
}

export async function makeOffer(pc, peerId, sendSignal) {
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  sendSignal(peerId, { description: pc.localDescription })
}

export async function handleSignal(pc, signal, peerId, sendSignal) {
  if (signal?.description) {
    await pc.setRemoteDescription(signal.description)
    if (signal.description.type === 'offer') {
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      sendSignal(peerId, { description: pc.localDescription })
    }
  } else if (signal?.candidate) {
    try { await pc.addIceCandidate(signal.candidate) } catch (error) {
      console.warn('Could not add ICE candidate:', error)
    }
  }
}
