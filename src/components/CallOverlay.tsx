import type { RefObject } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX, X } from 'lucide-react';
import type { ActiveCallInfo } from '../hooks/useVoiceCall';
import { formatDuration } from '../lib/api';
import { Avatar } from './Avatar';

interface CallOverlayProps {
  call: ActiveCallInfo | null;
  isMuted: boolean;
  isSpeakerMuted: boolean;
  elapsedSec: number;
  audioLevel: number;
  callNotice: string | null;
  remoteAudioRef: RefObject<HTMLAudioElement | null>;
  onAccept: () => void;
  onReject: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onClearNotice: () => void;
}

export function CallOverlay({
  call,
  isMuted,
  isSpeakerMuted,
  elapsedSec,
  audioLevel,
  callNotice,
  remoteAudioRef,
  onAccept,
  onReject,
  onHangup,
  onToggleMute,
  onToggleSpeaker,
  onClearNotice,
}: CallOverlayProps) {
  const statusLabel =
    call?.status === 'incoming'
      ? 'Incoming voice call'
      : call?.status === 'calling'
        ? 'Connecting audio...'
        : call?.status === 'ringing'
          ? 'Ringing...'
          : call?.status === 'connected'
            ? `Connected · ${formatDuration(elapsedSec)}`
            : '';

  const barHeights = [0.45, 0.85, 1, 0.7, 0.5];

  return (
    <>
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      {callNotice && (
        <div className="fixed top-4 right-4 z-50 max-w-sm bg-white dark:bg-[#131720] border border-slate-200 dark:border-slate-700 rounded-2xl shadow-lg px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
            {callNotice}
          </span>
          <button
            type="button"
            onClick={onClearNotice}
            aria-label="Dismiss notice"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {call && (
        <div className="fixed bottom-5 right-5 z-50 w-80 bg-slate-900 dark:bg-[#131720] text-white border border-slate-700/80 rounded-2xl shadow-2xl p-5">
          <div className="flex items-center gap-3.5">
            <Avatar name={call.peer.displayName} src={call.peer.avatarUrl} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{call.peer.displayName}</p>
              <p className="text-xs text-slate-300 font-mono tabular-nums mt-0.5">
                {statusLabel}
              </p>
            </div>
          </div>

          {call.status === 'connected' && (
            <div className="mt-4 flex items-center justify-center gap-1.5 h-6">
              {barHeights.map((mult, idx) => {
                const activeScale = isMuted ? 0.15 : Math.max(0.18, Math.min(1, audioLevel * mult * 1.4));
                return (
                  <span
                    key={idx}
                    className="w-1.5 rounded-full bg-emerald-400 transition-transform duration-100"
                    style={{
                      height: '20px',
                      transform: `scaleY(${activeScale})`,
                    }}
                  />
                );
              })}
            </div>
          )}

          <div className="mt-5 flex items-center justify-center gap-3">
            {call.status === 'incoming' ? (
              <>
                <button
                  type="button"
                  onClick={onReject}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <PhoneOff className="w-4 h-4" />
                  <span>Decline</span>
                </button>
                <button
                  type="button"
                  onClick={onAccept}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-[#058A45] hover:bg-[#047339] text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Phone className="w-4 h-4" />
                  <span>Answer</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onToggleMute}
                  title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                  aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                  className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                    isMuted
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                  }`}
                >
                  {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>

                <button
                  type="button"
                  onClick={onToggleSpeaker}
                  title={isSpeakerMuted ? 'Unmute speaker' : 'Mute speaker'}
                  aria-label={isSpeakerMuted ? 'Unmute speaker' : 'Mute speaker'}
                  className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                    isSpeakerMuted
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                  }`}
                >
                  {isSpeakerMuted ? (
                    <VolumeX className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={onHangup}
                  title="End voice call"
                  aria-label="End voice call"
                  className="flex-1 h-11 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <PhoneOff className="w-4 h-4" />
                  <span>End Call</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
