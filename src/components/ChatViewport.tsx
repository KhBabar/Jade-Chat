import {
  ChangeEvent,
  DragEvent,
  Fragment,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowLeft,
  Check,
  CheckCheck,
  FolderOpen,
  Mic,
  Paperclip,
  Phone,
  Reply,
  Send,
  Smile,
  Square,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import {
  formatDuration,
  formatFileSize,
  formatTime,
  uploadFile,
} from '../lib/api';
import type { FileAttachment, Message, MessageReply, MessageType, Room, User } from '../types';
import { AuthAudioPlayer, AuthDownloadButton, AuthImage, FileTypeIcon } from './AuthMedia';
import { Avatar } from './Avatar';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '🔥', '👏', '🙏', '👀'];
const COMPOSER_EMOJIS = [
  '😀', '😂', '🥹', '😍', '🤔', '👍', '👏', '🎉',
  '🔥', '❤️', '✅', '🚀', '📎', '🎙️', '☕', '👋',
];

function renderSafeMessageText(text: string) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, idx) => {
    if (/^https?:\/\/[^\s]+$/.test(part)) {
      try {
        const parsed = new URL(part);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          return (
            <a
              key={idx}
              href={parsed.toString()}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:opacity-80 break-all"
            >
              {part}
            </a>
          );
        }
      } catch {
        // Fallback to plain text
      }
    }
    return <Fragment key={idx}>{part}</Fragment>;
  });
}

function getDateLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (isSameDay(d, now)) return 'Today';
  const yesterday = new Date(now.getTime() - 86400000);
  if (isSameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

interface ChatViewportProps {
  room: Room;
  messages: Message[];
  currentUser: User;
  usersById: Record<string, User>;
  typingUsers: string[];
  loadingMessages: boolean;
  onBackMobile: () => void;
  onSendMessage: (payload: {
    messageType: MessageType;
    text: string;
    attachment?: FileAttachment;
    replyTo?: MessageReply;
  }) => void;
  onReact: (messageId: string, emoji: string) => void;
  onTypingChange: (isTyping: boolean) => void;
  onStartVoiceCall: (peer: User) => void;
  onOpenAddMembers: () => void;
  onOpenLightbox: (src: string, originalUrl: string, filename: string) => void;
}

export function ChatViewport({
  room,
  messages,
  currentUser,
  usersById,
  typingUsers,
  loadingMessages,
  onBackMobile,
  onSendMessage,
  onReact,
  onTypingChange,
  onStartVoiceCall,
  onOpenAddMembers,
  onOpenLightbox,
}: ChatViewportProps) {
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<MessageReply | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showFilesDrawer, setShowFilesDrawer] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordStartRef = useRef<number>(0);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [room.id, messages.length]);

  useEffect(() => {
    setDraft('');
    setReplyTo(null);
    setShowEmojiPicker(false);
    setUploadError(null);
  }, [room.id]);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current !== null) window.clearInterval(recordTimerRef.current);
      if (typingTimeoutRef.current !== null) window.clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  const sharedFiles = useMemo(() => {
    return messages
      .filter((m) => m.attachment && (m.type === 'file' || m.type === 'image' || m.type === 'voice'))
      .map((m) => ({
        attachment: m.attachment!,
        type: m.type,
        senderName: m.senderName,
        createdAt: m.createdAt,
      }))
      .reverse();
  }, [messages]);

  const handleDraftChange = (value: string) => {
    setDraft(value);
    onTypingChange(value.trim().length > 0);
    if (typingTimeoutRef.current !== null) {
      window.clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = window.setTimeout(() => {
      onTypingChange(false);
    }, 2000);
  };

  const handleSendText = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSendMessage({
      messageType: 'text',
      text: trimmed,
      replyTo: replyTo || undefined,
    });
    setDraft('');
    setReplyTo(null);
    setShowEmojiPicker(false);
    onTypingChange(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  };

  const processFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setUploadError(null);

    for (const file of files) {
      setUploadingCount((c) => c + 1);
      try {
        const uploaded = await uploadFile(file, file.name, room.id);
        const msgType: MessageType = file.type.startsWith('image/')
          ? 'image'
          : file.type.startsWith('audio/')
            ? 'voice'
            : 'file';

        onSendMessage({
          messageType: msgType,
          text: msgType === 'image' ? 'Sent an image' : `Shared file: ${file.name}`,
          attachment: uploaded,
          replyTo: replyTo || undefined,
        });
        setReplyTo(null);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : `Failed to upload ${file.name}`);
      } finally {
        setUploadingCount((c) => Math.max(0, c - 1));
      }
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) {
      processFiles(e.dataTransfer.files);
    }
  };

  const startVoiceRecording = async () => {
    setUploadError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recordedChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        for (const track of stream.getTracks()) track.stop();
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      recordStartRef.current = Date.now();
      setRecordingSec(0);
      setIsRecording(true);
      recordTimerRef.current = window.setInterval(() => {
        setRecordingSec(Math.floor((Date.now() - recordStartRef.current) / 1000));
      }, 250);
    } catch {
      setUploadError('Microphone access is needed to record voice messages.');
    }
  };

  const stopAndSendRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recordTimerRef.current !== null) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    const duration = Math.max(1, Math.round((Date.now() - recordStartRef.current) / 1000));
    setIsRecording(false);

    recorder.onstop = async () => {
      recorder.stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(recordedChunksRef.current, {
        type: recorder.mimeType || 'audio/webm',
      });
      if (blob.size < 100) return;

      setUploadingCount((c) => c + 1);
      try {
        const ext = (recorder.mimeType || '').includes('ogg') ? 'ogg' : 'webm';
        const uploaded = await uploadFile(blob, `voice-${Date.now()}.${ext}`, room.id, duration);
        onSendMessage({
          messageType: 'voice',
          text: `Voice note (${formatDuration(duration)})`,
          attachment: uploaded,
        });
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Failed to send voice note.');
      } finally {
        setUploadingCount((c) => Math.max(0, c - 1));
      }
    };
    recorder.stop();
  };

  const cancelRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recordTimerRef.current !== null) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    setIsRecording(false);
    if (recorder) {
      recorder.onstop = () => {
        recorder.stream.getTracks().forEach((t) => t.stop());
      };
      recorder.stop();
    }
  };

  const peerUser = room.type === 'dm' ? room.peerUser || null : null;
  const livePeer = peerUser ? usersById[peerUser.id] || peerUser : null;

  const headerSubtitle =
    room.type === 'notes'
      ? 'Personal space for drafts, files, and voice memos'
      : room.type === 'group'
        ? `${room.memberIds.length} members`
        : livePeer
          ? `${livePeer.isOnline ? 'Online' : 'Offline'} · @${livePeer.username}`
          : '';

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDragging(false);
      }}
      onDrop={handleDrop}
      className="relative flex-1 flex h-full min-w-0 bg-[#F5F6F8] dark:bg-[#0B0E14]"
    >
      {/* Main chat column */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Conversation Header */}
        <header className="h-16 px-4 sm:px-6 bg-white dark:bg-[#131720] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onBackMobile}
              aria-label="Back to conversations"
              className="md:hidden p-2 -ml-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            <Avatar
              name={room.name}
              src={room.avatarUrl}
              size="md"
              kind={room.type === 'notes' ? 'notes' : room.type === 'group' ? 'group' : 'user'}
              isOnline={Boolean(livePeer?.isOnline)}
              showOnline={room.type === 'dm'}
            />

            <div className="min-w-0">
              <h2 className="font-display text-sm sm:text-base font-semibold text-slate-900 dark:text-white truncate">
                {room.name}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {headerSubtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {room.type === 'dm' && livePeer && (
              <button
                type="button"
                onClick={() => onStartVoiceCall(livePeer)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#058A45] hover:bg-[#047339] text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Phone className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Voice Call</span>
              </button>
            )}

            {room.type === 'group' && (
              <button
                type="button"
                onClick={onOpenAddMembers}
                title="Add members to group"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Invite</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowFilesDrawer((prev) => !prev)}
              title="Toggle shared files drawer"
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showFilesDrawer
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Files</span>
              <span className="font-mono tabular-nums text-[11px] opacity-75">
                {sharedFiles.length}
              </span>
            </button>
          </div>
        </header>

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
          {loadingMessages ? (
            <div className="space-y-4 py-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-start gap-3 animate-pulse">
                  <div className="w-9 h-9 rounded-xl bg-slate-200 dark:bg-slate-800" />
                  <div className="space-y-2 flex-1 max-w-md">
                    <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-800" />
                    <div className="h-12 w-full rounded-2xl bg-slate-200 dark:bg-slate-800" />
                  </div>
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                No messages yet in {room.name}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
                Send a message, drag and drop files here, or record a voice note to start the conversation.
              </p>
            </div>
          ) : (
            messages.map((msg, idx) => {
              const prev = idx > 0 ? messages[idx - 1] : null;
              const showDateDivider =
                !prev || getDateLabel(prev.createdAt) !== getDateLabel(msg.createdAt);
              const isOwn = msg.senderId === currentUser.id;
              const isSystemCall = msg.type === 'call';
              const showSenderHeader =
                !isOwn && (!prev || prev.senderId !== msg.senderId || showDateDivider);

              const reactionEntries = Object.entries(msg.reactions || {});
              const isReadByPeer =
                isOwn &&
                room.type === 'dm' &&
                livePeer &&
                (msg.readBy || []).includes(livePeer.id);

              return (
                <Fragment key={msg.id}>
                  {showDateDivider && (
                    <div className="flex items-center justify-center py-2">
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        {getDateLabel(msg.createdAt)}
                      </span>
                    </div>
                  )}

                  {isSystemCall ? (
                    <div className="flex items-center justify-center py-1">
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-[#131720] border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                        <Phone className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span>{msg.text}</span>
                        <span className="text-[11px] font-mono tabular-nums text-slate-400">
                          {formatTime(msg.createdAt)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`group flex items-end gap-2.5 ${
                        isOwn ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      {!isOwn && (
                        <div className="w-8 shrink-0">
                          {showSenderHeader ? (
                            <Avatar
                              name={msg.senderName}
                              src={usersById[msg.senderId]?.avatarUrl || msg.senderAvatar}
                              size="sm"
                            />
                          ) : null}
                        </div>
                      )}

                      <div
                        className={`flex flex-col max-w-[82%] sm:max-w-[68%] ${
                          isOwn ? 'items-end' : 'items-start'
                        }`}
                      >
                        {showSenderHeader && (
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 px-1">
                            {msg.senderName}
                          </span>
                        )}

                        <div className="relative flex items-center gap-2">
                          {/* Quick hover actions (left of own message) */}
                          {isOwn && (
                            <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setReplyTo({
                                    id: msg.id,
                                    senderName: msg.senderName,
                                    text: msg.text,
                                  })
                                }
                                title="Reply"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white dark:hover:text-slate-200 dark:hover:bg-slate-800"
                              >
                                <Reply className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}

                          <div
                            className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                              isOwn
                                ? 'bg-[#D1F4DF] text-slate-900 dark:bg-[#11422A] dark:text-emerald-50 rounded-br-sm'
                                : 'bg-white text-slate-900 dark:bg-[#171C28] dark:text-slate-100 border border-slate-200/90 dark:border-slate-800 rounded-bl-sm'
                            }`}
                          >
                            {msg.replyTo && (
                              <div
                                className={`mb-2 px-2.5 py-1.5 rounded-lg text-xs border ${
                                  isOwn
                                    ? 'bg-emerald-950/5 border-emerald-700/20 text-slate-700 dark:bg-black/20 dark:border-emerald-400/20 dark:text-emerald-100'
                                    : 'bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'
                                }`}
                              >
                                <p className="font-semibold text-[11px]">
                                  {msg.replyTo.senderName}
                                </p>
                                <p className="truncate opacity-85">{msg.replyTo.text}</p>
                              </div>
                            )}

                            {msg.type === 'image' && msg.attachment ? (
                              <div className="space-y-1.5">
                                <AuthImage
                                  url={msg.attachment.url}
                                  alt={msg.attachment.name}
                                  onClick={(resolved) =>
                                    onOpenLightbox(
                                      resolved,
                                      msg.attachment!.url,
                                      msg.attachment!.name
                                    )
                                  }
                                  className="max-w-[260px] sm:max-w-[320px] max-h-72 rounded-xl object-cover"
                                />
                                <div className="flex items-center justify-between gap-3 text-[11px] opacity-75">
                                  <span className="truncate">{msg.attachment.name}</span>
                                  <span className="font-mono tabular-nums shrink-0">
                                    {formatFileSize(msg.attachment.size)}
                                  </span>
                                </div>
                              </div>
                            ) : msg.type === 'voice' && msg.attachment ? (
                              <AuthAudioPlayer
                                url={msg.attachment.url}
                                durationSec={msg.attachment.durationSec}
                                isOwn={isOwn}
                              />
                            ) : msg.type === 'file' && msg.attachment ? (
                              <div className="flex items-center gap-3 min-w-[220px] sm:min-w-[270px]">
                                <FileTypeIcon mimeType={msg.attachment.mimeType} />
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-semibold truncate">
                                    {msg.attachment.name}
                                  </p>
                                  <p className="text-[11px] font-mono tabular-nums opacity-75 mt-0.5">
                                    {formatFileSize(msg.attachment.size)}
                                  </p>
                                </div>
                                <AuthDownloadButton
                                  url={msg.attachment.url}
                                  filename={msg.attachment.name}
                                  compact
                                />
                              </div>
                            ) : (
                              <p className="whitespace-pre-wrap break-words">
                                {renderSafeMessageText(msg.text)}
                              </p>
                            )}
                          </div>

                          {/* Quick hover actions (right of peer message) */}
                          {!isOwn && (
                            <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setReplyTo({
                                    id: msg.id,
                                    senderName: msg.senderName,
                                    text: msg.text,
                                  })
                                }
                                title="Reply"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white dark:hover:text-slate-200 dark:hover:bg-slate-800"
                              >
                                <Reply className="w-3.5 h-3.5" />
                              </button>
                              {QUICK_EMOJIS.slice(0, 3).map((em) => (
                                <button
                                  key={em}
                                  type="button"
                                  onClick={() => onReact(msg.id, em)}
                                  className="px-1 py-1 text-xs rounded-lg hover:bg-white dark:hover:bg-slate-800"
                                >
                                  {em}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Reactions + Timestamp row */}
                        <div className="flex items-center gap-2 mt-1 px-1">
                          {reactionEntries.length > 0 && (
                            <div className="flex items-center gap-1.5">
                              {reactionEntries.map(([emoji, reactorIds]) => {
                                const reacted = reactorIds.includes(currentUser.id);
                                return (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => onReact(msg.id, emoji)}
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-mono tabular-nums border transition-colors ${
                                      reacted
                                        ? 'bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-950/60 dark:border-emerald-700 dark:text-emerald-200'
                                        : 'bg-white border-slate-200 text-slate-600 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'
                                    }`}
                                  >
                                    <span>{emoji}</span>
                                    <span>{reactorIds.length}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          <span className="text-[11px] font-mono tabular-nums text-slate-400 dark:text-slate-500 flex items-center gap-1">
                            {formatTime(msg.createdAt)}
                            {isOwn && (
                              isReadByPeer ? (
                                <CheckCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                              ) : (
                                <Check className="w-3.5 h-3.5 text-slate-400" />
                              )
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </Fragment>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Typing / Upload status bar */}
        {(typingUsers.length > 0 || uploadingCount > 0 || uploadError) && (
          <div className="px-6 py-1.5 text-xs flex items-center justify-between gap-4 bg-[#F5F6F8] dark:bg-[#0B0E14]">
            <span className="text-slate-500 dark:text-slate-400 truncate">
              {uploadError ? (
                <span className="text-red-600 dark:text-red-400">{uploadError}</span>
              ) : uploadingCount > 0 ? (
                `Uploading ${uploadingCount} file${uploadingCount > 1 ? 's' : ''}...`
              ) : (
                `${typingUsers.join(', ')} ${typingUsers.length === 1 ? 'is' : 'are'} typing...`
              )}
            </span>
          </div>
        )}

        {/* Composer */}
        <div className="bg-white dark:bg-[#131720] border-t border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3 shrink-0">
          {replyTo && (
            <div className="mb-2.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                  Replying to {replyTo.senderName}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-300 truncate">
                  {replyTo.text}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                aria-label="Cancel reply"
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {showEmojiPicker && (
            <div className="mb-2.5 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-wrap gap-1.5">
              {COMPOSER_EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => setDraft((prev) => `${prev}${em}`)}
                  className="w-8 h-8 rounded-lg hover:bg-white dark:hover:bg-slate-800 flex items-center justify-center text-base transition-colors"
                >
                  {em}
                </button>
              ))}
            </div>
          )}

          {isRecording ? (
            <div className="flex items-center justify-between gap-3 py-1.5 px-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
                <span className="text-xs font-medium text-slate-800 dark:text-slate-100">
                  Recording voice note
                </span>
                <span className="text-xs font-mono tabular-nums text-emerald-800 dark:text-emerald-300">
                  {formatDuration(recordingSec)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={cancelRecording}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Discard</span>
                </button>
                <button
                  type="button"
                  onClick={stopAndSendRecording}
                  className="px-3.5 py-1.5 rounded-lg bg-[#058A45] hover:bg-[#047339] text-white text-xs font-medium flex items-center gap-1.5"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>Send Note</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileInputChange}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Attach file or image"
                aria-label="Attach file or image"
                className="p-2.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
              >
                <Paperclip className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => setShowEmojiPicker((v) => !v)}
                title="Emoji picker"
                aria-label="Emoji picker"
                className="p-2.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
              >
                <Smile className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={startVoiceRecording}
                title="Record voice note"
                aria-label="Record voice note"
                className="p-2.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
              >
                <Mic className="w-5 h-5" />
              </button>

              <textarea
                rows={1}
                value={draft}
                onChange={(e) => handleDraftChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Message ${room.name}...`}
                className="flex-1 max-h-32 resize-none px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />

              <button
                type="button"
                onClick={handleSendText}
                disabled={!draft.trim()}
                aria-label="Send message"
                className="p-2.5 px-4 rounded-xl bg-[#058A45] hover:bg-[#047339] disabled:opacity-40 text-white font-medium text-xs flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline">Send</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Shared Files Drawer */}
      {showFilesDrawer && (
        <aside className="w-72 sm:w-80 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131720] flex flex-col h-full shrink-0">
          <div className="h-16 px-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
              Shared Files
            </h3>
            <button
              type="button"
              onClick={() => setShowFilesDrawer(false)}
              aria-label="Close shared files"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {sharedFiles.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-8 px-3">
                No files shared in this conversation yet. Drag and drop any file into the chat to share it.
              </p>
            ) : (
              sharedFiles.map((item, idx) => (
                <div
                  key={`${item.attachment.id}-${idx}`}
                  className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-3"
                >
                  <FileTypeIcon mimeType={item.attachment.mimeType} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-slate-900 dark:text-white truncate">
                      {item.attachment.name}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {item.senderName} ·{' '}
                      <span className="font-mono tabular-nums">
                        {formatFileSize(item.attachment.size)}
                      </span>
                    </p>
                  </div>
                  <AuthDownloadButton
                    url={item.attachment.url}
                    filename={item.attachment.name}
                    compact
                  />
                </div>
              ))
            )}
          </div>
        </aside>
      )}

      {/* Drag and drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-30 bg-emerald-950/35 backdrop-blur-xs border-2 border-dashed border-emerald-500 flex items-center justify-center pointer-events-none">
          <div className="bg-white dark:bg-[#131720] px-6 py-4 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 text-center">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              Drop files to share in {room.name}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Images, documents, and audio up to 25 MB
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
