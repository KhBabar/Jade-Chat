import { useCallback, useEffect, useRef, useState } from 'react';
import type { User, WsClientEvent, WsServerEvent } from '../types';

export type CallStatus = 'idle' | 'calling' | 'ringing' | 'incoming' | 'connected';

export interface ActiveCallInfo {
  callId: string;
  roomId: string;
  peer: User;
  direction: 'outgoing' | 'incoming';
  status: CallStatus;
  connectedAt?: number;
}

interface UseVoiceCallOptions {
  currentUser: User | null;
  sendWs: (event: WsClientEvent) => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export function useVoiceCall({ currentUser, sendWs }: UseVoiceCallOptions) {
  const [call, setCall] = useState<ActiveCallInfo | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [callNotice, setCallNotice] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const callRef = useRef<ActiveCallInfo | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserTimerRef = useRef<number | null>(null);
  const ringtoneTimerRef = useRef<number | null>(null);

  useEffect(() => {
    callRef.current = call;
  }, [call]);

  const stopRingtone = useCallback(() => {
    if (ringtoneTimerRef.current !== null) {
      window.clearInterval(ringtoneTimerRef.current);
      ringtoneTimerRef.current = null;
    }
  }, []);

  const playTonePulse = useCallback((freqA: number, freqB: number) => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freqA, now);
      osc.frequency.setValueAtTime(freqB, now + 0.16);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.38);
      setTimeout(() => {
        ctx.close().catch(() => {});
      }, 450);
    } catch {
      // Ignore Web Audio autoplay restriction
    }
  }, []);

  const startRingtone = useCallback(
    (incoming: boolean) => {
      stopRingtone();
      const pulse = () => playTonePulse(incoming ? 587.33 : 440, incoming ? 783.99 : 480);
      pulse();
      ringtoneTimerRef.current = window.setInterval(pulse, 2200);
    },
    [playTonePulse, stopRingtone]
  );

  const cleanupPeer = useCallback(() => {
    stopRingtone();
    if (analyserTimerRef.current !== null) {
      window.clearInterval(analyserTimerRef.current);
      analyserTimerRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onicecandidate = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
      localStreamRef.current = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    remoteStreamRef.current = null;
    pendingIceRef.current = [];
    setAudioLevel(0);
    setIsMuted(false);
    setIsSpeakerMuted(false);
    setElapsedSec(0);
  }, [stopRingtone]);

  useEffect(() => {
    if (call?.status !== 'connected' || !call.connectedAt) {
      setElapsedSec(0);
      return;
    }
    const start = call.connectedAt;
    const id = window.setInterval(() => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [call?.status, call?.connectedAt]);

  useEffect(() => {
    return () => {
      cleanupPeer();
    };
  }, [cleanupPeer]);

  const startMicMonitoring = useCallback((stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyserTimerRef.current = window.setInterval(() => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        setAudioLevel(Math.min(1, avg / 90));
      }, 90);
    } catch {
      // Optional meter
    }
  }, []);

  const preparePeerConnection = useCallback(
    async (callId: string, roomId: string, targetUserId: string) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      localStreamRef.current = stream;
      startMicMonitoring(stream);

      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcRef.current = pc;

      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }

      const remoteStream = new MediaStream();
      remoteStreamRef.current = remoteStream;
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
      }

      pc.ontrack = (event) => {
        for (const track of event.streams[0]?.getTracks() || [event.track]) {
          remoteStream.addTrack(track);
        }
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
          remoteAudioRef.current.play().catch(() => {});
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendWs({
            type: 'call:ice',
            callId,
            roomId,
            targetUserId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      return pc;
    },
    [sendWs, startMicMonitoring]
  );

  const startCall = useCallback(
    async (roomId: string, peer: User) => {
      if (!currentUser || callRef.current) return;
      setCallNotice(null);

      const callId = `call_${crypto.randomUUID().slice(0, 12)}`;
      const nextCall: ActiveCallInfo = {
        callId,
        roomId,
        peer,
        direction: 'outgoing',
        status: 'calling',
      };
      setCall(nextCall);
      callRef.current = nextCall;

      try {
        await preparePeerConnection(callId, roomId, peer.id);
        startRingtone(false);
        sendWs({
          type: 'call:invite',
          callId,
          roomId,
          calleeId: peer.id,
        });
      } catch (err) {
        cleanupPeer();
        setCall(null);
        setCallNotice(
          err instanceof Error && err.name === 'NotAllowedError'
            ? 'Microphone access was denied. Allow microphone permissions to place a voice call.'
            : 'Unable to access microphone for voice calling.'
        );
      }
    },
    [cleanupPeer, currentUser, preparePeerConnection, sendWs, startRingtone]
  );

  const acceptIncomingCall = useCallback(async () => {
    const active = callRef.current;
    if (!active || active.status !== 'incoming') return;
    stopRingtone();
    setCallNotice(null);

    try {
      await preparePeerConnection(active.callId, active.roomId, active.peer.id);
      const updated: ActiveCallInfo = {
        ...active,
        status: 'connected',
        connectedAt: Date.now(),
      };
      setCall(updated);
      callRef.current = updated;
      sendWs({
        type: 'call:accept',
        callId: active.callId,
        roomId: active.roomId,
        callerId: active.peer.id,
      });
    } catch (err) {
      sendWs({
        type: 'call:reject',
        callId: active.callId,
        roomId: active.roomId,
        callerId: active.peer.id,
        reason: 'mic_error',
      });
      cleanupPeer();
      setCall(null);
      setCallNotice(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Microphone permission denied. Unable to answer voice call.'
          : 'Could not initialize microphone to answer call.'
      );
    }
  }, [cleanupPeer, preparePeerConnection, sendWs, stopRingtone]);

  const rejectIncomingCall = useCallback(() => {
    const active = callRef.current;
    if (!active) return;
    sendWs({
      type: 'call:reject',
      callId: active.callId,
      roomId: active.roomId,
      callerId: active.peer.id,
      reason: 'rejected',
    });
    cleanupPeer();
    setCall(null);
  }, [cleanupPeer, sendWs]);

  const hangupCall = useCallback(() => {
    const active = callRef.current;
    if (!active) return;
    sendWs({
      type: 'call:hangup',
      callId: active.callId,
      roomId: active.roomId,
      targetUserId: active.peer.id,
    });
    cleanupPeer();
    setCall(null);
  }, [cleanupPeer, sendWs]);

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const next = !isMuted;
    for (const track of localStreamRef.current.getAudioTracks()) {
      track.enabled = !next;
    }
    setIsMuted(next);
  }, [isMuted]);

  const toggleSpeaker = useCallback(() => {
    if (!remoteAudioRef.current) return;
    const next = !isSpeakerMuted;
    remoteAudioRef.current.muted = next;
    setIsSpeakerMuted(next);
  }, [isSpeakerMuted]);

  const handleCallWsEvent = useCallback(
    async (event: WsServerEvent) => {
      switch (event.type) {
        case 'call:incoming': {
          if (callRef.current) {
            sendWs({
              type: 'call:reject',
              callId: event.callId,
              roomId: event.roomId,
              callerId: event.caller.id,
              reason: 'busy',
            });
            return;
          }
          const incoming: ActiveCallInfo = {
            callId: event.callId,
            roomId: event.roomId,
            peer: event.caller,
            direction: 'incoming',
            status: 'incoming',
          };
          setCall(incoming);
          callRef.current = incoming;
          startRingtone(true);
          break;
        }

        case 'call:ringing': {
          if (callRef.current?.callId === event.callId) {
            setCall((prev) => (prev ? { ...prev, status: 'ringing' } : prev));
          }
          break;
        }

        case 'call:accepted': {
          const active = callRef.current;
          if (!active || active.callId !== event.callId || !pcRef.current) return;
          stopRingtone();
          const connected: ActiveCallInfo = {
            ...active,
            status: 'connected',
            connectedAt: Date.now(),
          };
          setCall(connected);
          callRef.current = connected;

          try {
            const offer = await pcRef.current.createOffer();
            await pcRef.current.setLocalDescription(offer);
            sendWs({
              type: 'call:offer',
              callId: active.callId,
              roomId: active.roomId,
              targetUserId: active.peer.id,
              sdp: offer,
            });
          } catch {
            hangupCall();
          }
          break;
        }

        case 'call:offer': {
          const active = callRef.current;
          const pc = pcRef.current;
          if (!active || active.callId !== event.callId || !pc) return;
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(event.sdp));
            for (const candidate of pendingIceRef.current) {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
            pendingIceRef.current = [];
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendWs({
              type: 'call:answer',
              callId: active.callId,
              roomId: active.roomId,
              targetUserId: event.fromUserId,
              sdp: answer,
            });
          } catch {
            hangupCall();
          }
          break;
        }

        case 'call:answer': {
          const active = callRef.current;
          const pc = pcRef.current;
          if (!active || active.callId !== event.callId || !pc) return;
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(event.sdp));
            for (const candidate of pendingIceRef.current) {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
            pendingIceRef.current = [];
          } catch {
            hangupCall();
          }
          break;
        }

        case 'call:ice': {
          const active = callRef.current;
          const pc = pcRef.current;
          if (!active || active.callId !== event.callId || !pc) return;
          if (pc.remoteDescription) {
            pc.addIceCandidate(new RTCIceCandidate(event.candidate)).catch(() => {});
          } else {
            pendingIceRef.current.push(event.candidate);
          }
          break;
        }

        case 'call:busy': {
          if (callRef.current?.callId === event.callId) {
            cleanupPeer();
            setCall(null);
            setCallNotice('Recipient is currently on another call.');
          }
          break;
        }

        case 'call:rejected':
        case 'call:ended': {
          if (callRef.current?.callId === event.callId) {
            cleanupPeer();
            setCall(null);
            if (event.type === 'call:ended' && event.reason === 'offline') {
              setCallNotice('Recipient is currently offline.');
            } else if (
              event.type === 'call:rejected' ||
              (event.type === 'call:ended' && event.reason === 'rejected')
            ) {
              setCallNotice('Call was declined.');
            }
          }
          break;
        }
      }
    },
    [cleanupPeer, hangupCall, sendWs, startRingtone, stopRingtone]
  );

  return {
    call,
    isMuted,
    isSpeakerMuted,
    elapsedSec,
    audioLevel,
    callNotice,
    clearCallNotice: () => setCallNotice(null),
    remoteAudioRef,
    startCall,
    acceptIncomingCall,
    rejectIncomingCall,
    hangupCall,
    toggleMute,
    toggleSpeaker,
    handleCallWsEvent,
  };
}
