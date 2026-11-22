import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FolderOpen,
  LogOut,
  MessageSquare,
  Moon,
  Phone,
  Plus,
  Search,
  Sun,
  Users,
} from 'lucide-react';
import { useVoiceCall } from '../hooks/useVoiceCall';
import {
  apiRequest,
  clearMediaCache,
  formatFileSize,
  formatListTime,
  getAuthToken,
  setAuthToken,
} from '../lib/api';
import type {
  FileAttachment,
  Message,
  MessageReply,
  MessageType,
  Room,
  User,
  WsClientEvent,
  WsServerEvent,
} from '../types';
import { AuthDownloadButton, FileTypeIcon } from './AuthMedia';
import { Avatar } from './Avatar';
import { CallOverlay } from './CallOverlay';
import { ChatViewport } from './ChatViewport';
import {
  AddMembersModal,
  LightboxModal,
  NewGroupModal,
  ProfileModal,
} from './Modals';

interface WorkspaceProps {
  initialUser: User;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onLogout: () => void;
}

type RailTab = 'chats' | 'contacts' | 'files';
type ChatFilter = 'all' | 'unread' | 'groups';
type FileFilter = 'all' | 'images' | 'documents' | 'voice';

export function Workspace({
  initialUser,
  darkMode,
  onToggleDarkMode,
  onLogout,
}: WorkspaceProps) {
  const [currentUser, setCurrentUser] = useState<User>(initialUser);
  const [railTab, setRailTab] = useState<RailTab>('chats');
  const [chatFilter, setChatFilter] = useState<ChatFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [usersById, setUsersById] = useState<Record<string, User>>({
    [initialUser.id]: initialUser,
  });
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [messagesByRoom, setMessagesByRoom] = useState<Record<string, Message[]>>({});
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [loadingMessagesRoomId, setLoadingMessagesRoomId] = useState<string | null>(null);
  const [typingByRoom, setTypingByRoom] = useState<Record<string, Record<string, string>>>({});
  const [wsConnected, setWsConnected] = useState(false);

  // Global files state
  const [allFiles, setAllFiles] = useState<FileAttachment[]>([]);
  const [fileFilter, setFileFilter] = useState<FileFilter>('all');
  const [loadingFiles, setLoadingFiles] = useState(false);

  // Modals
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);
  const [showAddMembersModal, setShowAddMembersModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [lightbox, setLightbox] = useState<{
    src: string;
    originalUrl: string;
    filename: string;
  } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const activeRoomIdRef = useRef<string | null>(null);
  const typingTimersRef = useRef<Record<string, number>>({});
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
  }, [activeRoomId]);

  const sendWs = useCallback((event: WsClientEvent) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }, []);

  const voiceCall = useVoiceCall({ currentUser, sendWs });
  const handleCallWsEventRef = useRef(voiceCall.handleCallWsEvent);
  useEffect(() => {
    handleCallWsEventRef.current = voiceCall.handleCallWsEvent;
  }, [voiceCall.handleCallWsEvent]);

  const loadRoomsAndUsers = useCallback(async () => {
    try {
      const [usersRes, roomsRes] = await Promise.all([
        apiRequest<{ users: User[] }>('/api/users'),
        apiRequest<{ rooms: Room[] }>('/api/rooms'),
      ]);
      const userMap: Record<string, User> = {};
      for (const u of usersRes.users) {
        userMap[u.id] = u;
      }
      setUsersById(userMap);
      setRooms(roomsRes.rooms);
      setActiveRoomId((prev) => {
        if (prev && roomsRes.rooms.some((r) => r.id === prev)) return prev;
        // On desktop auto-select lobby if available
        if (window.innerWidth >= 768 && roomsRes.rooms.length > 0) {
          return roomsRes.rooms[0].id;
        }
        return null;
      });
    } finally {
      setLoadingRooms(false);
    }
  }, []);

  const loadMessagesForRoom = useCallback(async (roomId: string) => {
    setLoadingMessagesRoomId(roomId);
    try {
      const res = await apiRequest<{ messages: Message[] }>(`/api/rooms/${roomId}/messages`);
      setMessagesByRoom((prev) => ({
        ...prev,
        [roomId]: res.messages,
      }));
      // Mark read on server
      const latestTs = res.messages[res.messages.length - 1]?.createdAt || Date.now();
      sendWs({ type: 'message:read', roomId, timestamp: latestTs });
      setRooms((prev) =>
        prev.map((r) => (r.id === roomId ? { ...r, unreadCount: 0 } : r))
      );
    } finally {
      setLoadingMessagesRoomId((cur) => (cur === roomId ? null : cur));
    }
  }, [sendWs]);

  useEffect(() => {
    loadRoomsAndUsers();
  }, [loadRoomsAndUsers]);

  useEffect(() => {
    if (activeRoomId) {
      loadMessagesForRoom(activeRoomId);
    }
  }, [activeRoomId, loadMessagesForRoom]);

  const loadAllFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const res = await apiRequest<{ files: FileAttachment[] }>('/api/files/all');
      setAllFiles(res.files);
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  useEffect(() => {
    if (railTab === 'files') {
      loadAllFiles();
    }
  }, [railTab, loadAllFiles]);

  // WebSocket lifecycle with auto-reconnect
  useEffect(() => {
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;
      const token = getAuthToken();
      if (!token) return;

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'auth', token }));
      };

      ws.onmessage = (raw) => {
        let event: WsServerEvent;
        try {
          event = JSON.parse(raw.data) as WsServerEvent;
        } catch {
          return;
        }

        if (event.type.startsWith('call:')) {
          handleCallWsEventRef.current(event);
          return;
        }

        switch (event.type) {
          case 'auth:ok': {
            setWsConnected(true);
            reconnectAttemptRef.current = 0;
            const onlineSet = new Set(event.onlineUserIds);
            setUsersById((prev) => {
              const next = { ...prev };
              for (const uid of Object.keys(next)) {
                next[uid] = { ...next[uid], isOnline: onlineSet.has(uid) };
              }
              return next;
            });
            // Sync room list & active room messages after reconnect
            loadRoomsAndUsers();
            if (activeRoomIdRef.current) {
              loadMessagesForRoom(activeRoomIdRef.current);
            }
            break;
          }

          case 'presence:update': {
            setUsersById((prev) => {
              const existing = prev[event.userId];
              if (!existing) return prev;
              return {
                ...prev,
                [event.userId]: {
                  ...existing,
                  isOnline: event.isOnline,
                  lastSeenAt: event.lastSeenAt,
                },
              };
            });
            setRooms((prev) =>
              prev.map((r) =>
                r.peerUser && r.peerUser.id === event.userId
                  ? {
                      ...r,
                      peerUser: {
                        ...r.peerUser,
                        isOnline: event.isOnline,
                        lastSeenAt: event.lastSeenAt,
                      },
                    }
                  : r
              )
            );
            break;
          }

          case 'user:registered':
          case 'user:updated': {
            setUsersById((prev) => ({
              ...prev,
              [event.user.id]: event.user,
            }));
            if (event.user.id === currentUser.id) {
              setCurrentUser(event.user);
            }
            setRooms((prev) =>
              prev.map((r) =>
                r.type === 'dm' && r.peerUser?.id === event.user.id
                  ? {
                      ...r,
                      name: event.user.displayName,
                      avatarUrl: event.user.avatarUrl,
                      peerUser: event.user,
                    }
                  : r
              )
            );
            break;
          }

          case 'room:created':
          case 'room:updated': {
            setRooms((prev) => {
              const idx = prev.findIndex((r) => r.id === event.room.id);
              if (idx >= 0) {
                const copy = [...prev];
                copy[idx] = { ...copy[idx], ...event.room };
                return copy;
              }
              return [event.room, ...prev];
            });
            break;
          }

          case 'message:created': {
            const incoming = event.message;
            setMessagesByRoom((prev) => {
              const existing = prev[incoming.roomId] || [];
              // Reconcile optimistic message if clientTempId matches
              if (incoming.clientTempId) {
                const optIdx = existing.findIndex(
                  (m) => m.clientTempId === incoming.clientTempId || m.id === incoming.id
                );
                if (optIdx >= 0) {
                  const copy = [...existing];
                  copy[optIdx] = incoming;
                  return { ...prev, [incoming.roomId]: copy };
                }
              }
              // Idempotent duplicate guard
              if (existing.some((m) => m.id === incoming.id)) {
                return prev;
              }
              return { ...prev, [incoming.roomId]: [...existing, incoming] };
            });

            const isViewing = activeRoomIdRef.current === incoming.roomId;
            if (isViewing && incoming.senderId !== currentUser.id) {
              sendWs({
                type: 'message:read',
                roomId: incoming.roomId,
                timestamp: incoming.createdAt,
              });
            }

            setRooms((prev) => {
              const updated = prev.map((r) => {
                if (r.id !== incoming.roomId) return r;
                const incUnread =
                  !isViewing && incoming.senderId !== currentUser.id ? 1 : 0;
                return {
                  ...r,
                  lastMessage: incoming,
                  unreadCount: isViewing ? 0 : (r.unreadCount || 0) + incUnread,
                };
              });
              return [...updated].sort((a, b) => {
                const ta = a.lastMessage?.createdAt ?? a.createdAt;
                const tb = b.lastMessage?.createdAt ?? b.createdAt;
                return tb - ta;
              });
            });

            if (incoming.attachment) {
              setAllFiles((prev) =>
                prev.some((f) => f.id === incoming.attachment!.id)
                  ? prev
                  : [
                      {
                        ...incoming.attachment!,
                        roomId: incoming.roomId,
                        uploaderId: incoming.senderId,
                        uploaderName: incoming.senderName,
                        createdAt: incoming.createdAt,
                      },
                      ...prev,
                    ]
              );
            }
            break;
          }

          case 'message:reaction_updated': {
            setMessagesByRoom((prev) => {
              const list = prev[event.roomId];
              if (!list) return prev;
              return {
                ...prev,
                [event.roomId]: list.map((m) =>
                  m.id === event.messageId ? { ...m, reactions: event.reactions } : m
                ),
              };
            });
            break;
          }

          case 'message:read_updated': {
            setMessagesByRoom((prev) => {
              const list = prev[event.roomId];
              if (!list) return prev;
              return {
                ...prev,
                [event.roomId]: list.map((m) => {
                  if (m.createdAt > event.timestamp) return m;
                  const cur = m.readBy || [];
                  if (cur.includes(event.userId)) return m;
                  return { ...m, readBy: [...cur, event.userId] };
                }),
              };
            });
            break;
          }

          case 'typing:update': {
            const key = `${event.roomId}:${event.userId}`;
            if (typingTimersRef.current[key]) {
              window.clearTimeout(typingTimersRef.current[key]);
              delete typingTimersRef.current[key];
            }

            setTypingByRoom((prev) => {
              const roomTyping = { ...(prev[event.roomId] || {}) };
              if (event.isTyping) {
                roomTyping[event.userId] = event.displayName;
              } else {
                delete roomTyping[event.userId];
              }
              return { ...prev, [event.roomId]: roomTyping };
            });

            if (event.isTyping) {
              typingTimersRef.current[key] = window.setTimeout(() => {
                setTypingByRoom((prev) => {
                  const roomTyping = { ...(prev[event.roomId] || {}) };
                  delete roomTyping[event.userId];
                  return { ...prev, [event.roomId]: roomTyping };
                });
              }, 3200);
            }
            break;
          }
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (unmounted) return;
        const delay = Math.min(8000, 1000 * Math.pow(2, reconnectAttemptRef.current));
        reconnectAttemptRef.current += 1;
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
    };
  }, [currentUser.id, loadMessagesForRoom, loadRoomsAndUsers, sendWs]);

  const handleSendMessage = useCallback(
    (payload: {
      messageType: MessageType;
      text: string;
      attachment?: FileAttachment;
      replyTo?: MessageReply;
    }) => {
      if (!activeRoomId) return;
      const clientTempId = `tmp_${crypto.randomUUID().slice(0, 10)}`;
      const optimistic: Message = {
        id: clientTempId,
        clientTempId,
        roomId: activeRoomId,
        senderId: currentUser.id,
        senderName: currentUser.displayName,
        senderAvatar: currentUser.avatarUrl,
        type: payload.messageType,
        text: payload.text,
        attachment: payload.attachment,
        replyTo: payload.replyTo,
        reactions: {},
        readBy: [currentUser.id],
        createdAt: Date.now(),
      };

      setMessagesByRoom((prev) => ({
        ...prev,
        [activeRoomId]: [...(prev[activeRoomId] || []), optimistic],
      }));

      sendWs({
        type: 'message:send',
        clientTempId,
        roomId: activeRoomId,
        messageType: payload.messageType,
        text: payload.text,
        attachment: payload.attachment,
        replyTo: payload.replyTo,
      });
    },
    [activeRoomId, currentUser, sendWs]
  );

  const openDirectMessage = useCallback(async (targetUser: User) => {
    const res = await apiRequest<{ room: Room }>('/api/rooms/dm', {
      method: 'POST',
      body: JSON.stringify({ targetUserId: targetUser.id }),
    });
    setRooms((prev) => {
      if (prev.some((r) => r.id === res.room.id)) return prev;
      return [res.room, ...prev];
    });
    setActiveRoomId(res.room.id);
    setRailTab('chats');
    return res.room;
  }, []);

  const callContact = useCallback(
    async (targetUser: User) => {
      const room = await openDirectMessage(targetUser);
      await voiceCall.startCall(room.id, targetUser);
    },
    [openDirectMessage, voiceCall]
  );

  const handleLogoutClick = () => {
    wsRef.current?.close();
    setAuthToken(null);
    clearMediaCache();
    onLogout();
  };

  const totalUnread = useMemo(
    () => rooms.reduce((sum, r) => sum + (r.unreadCount || 0), 0),
    [rooms]
  );

  const filteredRooms = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rooms.filter((r) => {
      if (chatFilter === 'unread' && !(r.unreadCount && r.unreadCount > 0)) return false;
      if (chatFilter === 'groups' && r.type !== 'group') return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rooms, chatFilter, searchQuery]);

  const contactsList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return Object.values(usersById)
      .filter((u) => u.id !== currentUser.id)
      .filter(
        (u) =>
          !q ||
          u.displayName.toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        if (Boolean(a.isOnline) !== Boolean(b.isOnline)) {
          return a.isOnline ? -1 : 1;
        }
        return a.displayName.localeCompare(b.displayName);
      });
  }, [usersById, currentUser.id, searchQuery]);

  const filteredGlobalFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allFiles.filter((f) => {
      if (fileFilter === 'images' && !f.mimeType.startsWith('image/')) return false;
      if (fileFilter === 'voice' && !f.mimeType.startsWith('audio/')) return false;
      if (
        fileFilter === 'documents' &&
        (f.mimeType.startsWith('image/') || f.mimeType.startsWith('audio/'))
      ) {
        return false;
      }
      if (
        q &&
        !f.name.toLowerCase().includes(q) &&
        !(f.uploaderName || '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [allFiles, fileFilter, searchQuery]);

  const activeRoom = useMemo(
    () => rooms.find((r) => r.id === activeRoomId) || null,
    [rooms, activeRoomId]
  );

  const activeMessages = activeRoomId ? messagesByRoom[activeRoomId] || [] : [];
  const activeTypingUsers = activeRoomId
    ? Object.values(typingByRoom[activeRoomId] || {})
    : [];

  const allUsersArray = useMemo(() => Object.values(usersById), [usersById]);

  const showMobileChatOnly = Boolean(activeRoomId && railTab === 'chats');

  return (
    <div className="h-[100dvh] w-full flex flex-col md:flex-row bg-[#F5F6F8] dark:bg-[#0B0E14] text-slate-900 dark:text-slate-100 overflow-hidden">
      {/* Desktop Left Navigation Rail */}
      <nav
        aria-label="Primary workspace navigation"
        className="hidden md:flex w-[68px] bg-[#EBECEF] dark:bg-[#0F131C] border-r border-slate-200 dark:border-slate-800 flex-col items-center justify-between py-4 shrink-0"
      >
        <div className="flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={() => setShowProfileModal(true)}
            title={`${currentUser.displayName} (@${currentUser.username})`}
            className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 cursor-pointer"
          >
            <Avatar
              name={currentUser.displayName}
              src={currentUser.avatarUrl}
              size="md"
              isOnline={wsConnected}
              showOnline={wsConnected}
            />
          </button>

          <div className="w-8 h-px bg-slate-300/70 dark:bg-slate-800 my-1" />

          <button
            type="button"
            onClick={() => setRailTab('chats')}
            title="Chats"
            aria-label="Chats"
            className={`relative w-11 h-11 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
              railTab === 'chats'
                ? 'bg-[#058A45] text-white'
                : 'text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800'
            }`}
          >
            <MessageSquare className="w-5 h-5" />
            {totalUnread > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-md bg-red-600 text-white text-[10px] font-mono tabular-nums font-semibold flex items-center justify-center">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setRailTab('contacts')}
            title="Contacts"
            aria-label="Contacts"
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
              railTab === 'contacts'
                ? 'bg-[#058A45] text-white'
                : 'text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800'
            }`}
          >
            <Users className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => setRailTab('files')}
            title="Shared Files"
            aria-label="Shared Files"
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
              railTab === 'files'
                ? 'bg-[#058A45] text-white'
                : 'text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800'
            }`}
          >
            <FolderOpen className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-col items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowNewGroupModal(true)}
            title="Create group chat"
            aria-label="Create group chat"
            className="w-10 h-10 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer"
          >
            <Plus className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={onToggleDarkMode}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle color theme"
            className="w-10 h-10 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={handleLogoutClick}
            title="Sign out"
            aria-label="Sign out"
            className="w-10 h-10 rounded-xl text-slate-600 dark:text-slate-400 hover:text-red-600 hover:bg-white dark:hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </nav>

      {/* Middle Sidebar List Panel (Conversations / Contacts / Mobile Files) */}
      <aside
        className={`${
          showMobileChatOnly ? 'hidden md:flex' : 'flex'
        } ${
          railTab === 'files' ? 'md:hidden' : ''
        } w-full md:w-[320px] flex-1 md:flex-none bg-white dark:bg-[#131720] border-r border-slate-200 dark:border-slate-800 flex-col min-h-0 shrink-0`}
      >
        {/* Top Search & Action Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <h1 className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white">
              {railTab === 'chats'
                ? 'Chats'
                : railTab === 'contacts'
                  ? 'Contacts'
                  : 'Shared Files'}
            </h1>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowProfileModal(true)}
                className="md:hidden p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Profile settings"
              >
                <Avatar name={currentUser.displayName} src={currentUser.avatarUrl} size="sm" />
              </button>
              <button
                type="button"
                onClick={() => setShowNewGroupModal(true)}
                title="New Group"
                aria-label="New Group"
                className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                railTab === 'chats'
                  ? 'Search conversations...'
                  : railTab === 'contacts'
                    ? 'Search people by name or @handle...'
                    : 'Search files...'
              }
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-900 border border-transparent focus:border-emerald-600 focus:bg-white dark:focus:bg-slate-950 text-slate-900 dark:text-white focus:outline-none transition-colors"
            />
          </div>

          {railTab === 'chats' && (
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-xl">
              {(['all', 'unread', 'groups'] as ChatFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setChatFilter(f)}
                  className={`flex-1 py-1.5 px-2.5 text-xs font-medium rounded-lg capitalize transition-colors whitespace-nowrap ${
                    chatFilter === f
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* List Body */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
          {railTab === 'chats' && (
            <>
              {loadingRooms ? (
                <div className="p-4 space-y-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-center gap-3 animate-pulse">
                      <div className="w-10 h-10 rounded-xl bg-slate-200 dark:bg-slate-800" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3.5 w-28 rounded bg-slate-200 dark:bg-slate-800" />
                        <div className="h-3 w-44 rounded bg-slate-200 dark:bg-slate-800" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredRooms.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    No matching conversations
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Switch to Contacts to start a direct chat or create a group.
                  </p>
                </div>
              ) : (
                filteredRooms.map((room) => {
                  const isActive = room.id === activeRoomId;
                  const livePeer =
                    room.type === 'dm' && room.peerUser
                      ? usersById[room.peerUser.id] || room.peerUser
                      : null;
                  const preview = room.lastMessage
                    ? room.lastMessage.type === 'image'
                      ? '[Image]'
                      : room.lastMessage.type === 'voice'
                        ? '[Voice note]'
                        : room.lastMessage.type === 'file'
                          ? `[File] ${room.lastMessage.attachment?.name || ''}`
                          : room.lastMessage.text
                    : 'No messages yet';

                  const timeStamp = room.lastMessage?.createdAt ?? room.createdAt;

                  return (
                    <button
                      key={room.id}
                      type="button"
                      onClick={() => setActiveRoomId(room.id)}
                      className={`w-full px-4 py-3 flex items-center gap-3 text-left transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-emerald-50/90 dark:bg-emerald-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <Avatar
                        name={room.name}
                        src={room.avatarUrl}
                        size="md"
                        kind={
                          room.type === 'notes'
                            ? 'notes'
                            : room.type === 'group'
                              ? 'group'
                              : 'user'
                        }
                        isOnline={Boolean(livePeer?.isOnline)}
                        showOnline={room.type === 'dm'}
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                            {room.name}
                          </span>
                          <span className="text-[11px] font-mono tabular-nums text-slate-400 dark:text-slate-500 shrink-0">
                            {formatListTime(timeStamp)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                            {preview}
                          </span>
                          {room.unreadCount && room.unreadCount > 0 ? (
                            <span className="min-w-[18px] h-[18px] px-1 rounded-md bg-[#058A45] text-white text-[10px] font-mono tabular-nums font-semibold flex items-center justify-center shrink-0">
                              {room.unreadCount}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </>
          )}

          {railTab === 'contacts' && (
            <>
              {contactsList.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    No other users registered yet
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                    Open a second browser tab and register another account to test real-time chat, file transfer, and voice calling.
                  </p>
                </div>
              ) : (
                contactsList.map((person) => (
                  <div
                    key={person.id}
                    className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar
                        name={person.displayName}
                        src={person.avatarUrl}
                        size="md"
                        isOnline={Boolean(person.isOnline)}
                        showOnline
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {person.displayName}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {person.isOnline ? 'Online' : 'Offline'} · @{person.username}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openDirectMessage(person)}
                        title={`Message ${person.displayName}`}
                        aria-label={`Message ${person.displayName}`}
                        className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      >
                        <MessageSquare className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => callContact(person)}
                        title={`Call ${person.displayName}`}
                        aria-label={`Call ${person.displayName}`}
                        className="p-2 rounded-xl bg-[#058A45] hover:bg-[#047339] text-white transition-colors cursor-pointer"
                      >
                        <Phone className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </>
          )}

          {railTab === 'files' && (
            <div className="md:hidden p-3 space-y-2.5">
              {filteredGlobalFiles.length === 0 ? (
                <p className="p-6 text-xs text-slate-500 dark:text-slate-400 text-center">
                  No shared files found.
                </p>
              ) : (
                filteredGlobalFiles.map((f) => (
                  <div
                    key={f.id}
                    className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-3"
                  >
                    <FileTypeIcon mimeType={f.mimeType} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate">{f.name}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {f.uploaderName || 'Member'} ·{' '}
                        <span className="font-mono tabular-nums">{formatFileSize(f.size)}</span>
                      </p>
                    </div>
                    <AuthDownloadButton url={f.url} filename={f.name} compact />
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Main Desktop Viewport */}
      <main
        className={`${
          showMobileChatOnly ? 'flex' : 'hidden md:flex'
        } flex-1 min-w-0 h-full`}
      >
        {railTab === 'files' ? (
          <div className="flex-1 flex flex-col h-full bg-[#F5F6F8] dark:bg-[#0B0E14]">
            <header className="h-16 px-6 bg-white dark:bg-[#131720] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 shrink-0">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Shared Files Vault
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  All images, documents, and voice notes shared across your conversations
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="relative w-56">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter files..."
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
                <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-xl">
                  {(['all', 'images', 'documents', 'voice'] as FileFilter[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setFileFilter(t)}
                      className={`px-3 py-1 text-xs font-medium rounded-lg capitalize transition-colors whitespace-nowrap ${
                        fileFilter === t
                          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-6">
              {loadingFiles ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Loading files...</p>
              ) : filteredGlobalFiles.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <FolderOpen className="w-10 h-10 text-slate-300 dark:text-slate-700 mb-3" />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    No files shared yet
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Attach or drag-and-drop any file inside a conversation to see it indexed here.
                  </p>
                </div>
              ) : (
                <div className="bg-white dark:bg-[#131720] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <th className="py-3 px-4">File Name</th>
                        <th className="py-3 px-4">Shared By</th>
                        <th className="py-3 px-4">Date</th>
                        <th className="py-3 px-4 text-right">Size</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
                      {filteredGlobalFiles.map((file) => (
                        <tr
                          key={file.id}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                        >
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3 min-w-0">
                              <FileTypeIcon mimeType={file.mimeType} />
                              <span className="font-medium text-slate-900 dark:text-white truncate max-w-xs">
                                {file.name}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-300">
                            {file.uploaderName || 'Member'}
                          </td>
                          <td className="py-3 px-4 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                            {file.createdAt ? formatListTime(file.createdAt) : '—'}
                          </td>
                          <td className="py-3 px-4 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300 text-right">
                            {formatFileSize(file.size)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <AuthDownloadButton url={file.url} filename={file.name} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : activeRoom ? (
          <ChatViewport
            room={activeRoom}
            messages={activeMessages}
            currentUser={currentUser}
            usersById={usersById}
            typingUsers={activeTypingUsers}
            loadingMessages={loadingMessagesRoomId === activeRoom.id && activeMessages.length === 0}
            onBackMobile={() => setActiveRoomId(null)}
            onSendMessage={handleSendMessage}
            onReact={(messageId, emoji) =>
              sendWs({ type: 'message:react', roomId: activeRoom.id, messageId, emoji })
            }
            onTypingChange={(isTyping) =>
              sendWs({
                type: isTyping ? 'typing:start' : 'typing:stop',
                roomId: activeRoom.id,
              })
            }
            onStartVoiceCall={(peer) => voiceCall.startCall(activeRoom.id, peer)}
            onOpenAddMembers={() => setShowAddMembersModal(true)}
            onOpenLightbox={(src, originalUrl, filename) =>
              setLightbox({ src, originalUrl, filename })
            }
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-72 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 mb-5 bg-white dark:bg-slate-900">
              <img
                src="/src/assets/images/welcome_chat_illustration_1795367489292.jpg"
                alt="JadeChat workspace"
                referrerPolicy="no-referrer"
                className="w-full h-44 object-cover"
              />
            </div>
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              Select a conversation to begin
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mt-1.5">
              Choose an existing chat from the sidebar or visit Contacts to start a direct message or voice call.
            </p>
          </div>
        )}
      </main>

      {/* Mobile Bottom Navigation Bar (only when not inside a chat viewport) */}
      {!showMobileChatOnly && (
        <nav
          aria-label="Mobile navigation"
          className="md:hidden h-14 bg-white dark:bg-[#131720] border-t border-slate-200 dark:border-slate-800 grid grid-cols-3 items-center shrink-0"
        >
          <button
            type="button"
            onClick={() => setRailTab('chats')}
            className={`h-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
              railTab === 'chats'
                ? 'text-[#058A45] dark:text-emerald-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Chats</span>
          </button>
          <button
            type="button"
            onClick={() => setRailTab('contacts')}
            className={`h-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
              railTab === 'contacts'
                ? 'text-[#058A45] dark:text-emerald-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Contacts</span>
          </button>
          <button
            type="button"
            onClick={() => setRailTab('files')}
            className={`h-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
              railTab === 'files'
                ? 'text-[#058A45] dark:text-emerald-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <FolderOpen className="w-4 h-4" />
            <span>Files</span>
          </button>
        </nav>
      )}

      {/* Voice Call Overlay */}
      <CallOverlay
        call={voiceCall.call}
        isMuted={voiceCall.isMuted}
        isSpeakerMuted={voiceCall.isSpeakerMuted}
        elapsedSec={voiceCall.elapsedSec}
        audioLevel={voiceCall.audioLevel}
        callNotice={voiceCall.callNotice}
        remoteAudioRef={voiceCall.remoteAudioRef}
        onAccept={voiceCall.acceptIncomingCall}
        onReject={voiceCall.rejectIncomingCall}
        onHangup={voiceCall.hangupCall}
        onToggleMute={voiceCall.toggleMute}
        onToggleSpeaker={voiceCall.toggleSpeaker}
        onClearNotice={voiceCall.clearCallNotice}
      />

      {/* Modals */}
      {showNewGroupModal && (
        <NewGroupModal
          users={allUsersArray}
          currentUserId={currentUser.id}
          onClose={() => setShowNewGroupModal(false)}
          onCreated={(room) => {
            setRooms((prev) => (prev.some((r) => r.id === room.id) ? prev : [room, ...prev]));
            setActiveRoomId(room.id);
            setRailTab('chats');
          }}
        />
      )}

      {showAddMembersModal && activeRoom && (
        <AddMembersModal
          room={activeRoom}
          users={allUsersArray}
          onClose={() => setShowAddMembersModal(false)}
          onUpdated={(updatedRoom) => {
            setRooms((prev) =>
              prev.map((r) => (r.id === updatedRoom.id ? updatedRoom : r))
            );
          }}
        />
      )}

      {showProfileModal && (
        <ProfileModal
          user={currentUser}
          onClose={() => setShowProfileModal(false)}
          onUpdated={(updatedUser) => {
            setCurrentUser(updatedUser);
            setUsersById((prev) => ({ ...prev, [updatedUser.id]: updatedUser }));
          }}
        />
      )}

      {lightbox && (
        <LightboxModal
          src={lightbox.src}
          originalUrl={lightbox.originalUrl}
          filename={lightbox.filename}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
