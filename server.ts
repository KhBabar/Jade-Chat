import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  FileAttachment,
  Message,
  MessageReply,
  MessageType,
  Room,
  User,
  WsClientEvent,
  WsServerEvent,
} from './src/types.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOADS_DIR = path.resolve(DATA_DIR, 'uploads');
const STORE_PATH = path.resolve(DATA_DIR, 'store.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

interface StoredUser extends User {
  passwordHash: string;
}

interface StoredFile {
  id: string;
  diskName: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploaderId: string;
  roomId: string;
  durationSec?: number;
  createdAt: number;
}

interface StoreData {
  users: Record<string, StoredUser>;
  usernameIndex: Record<string, string>;
  rooms: Record<string, Room>;
  messages: Record<string, Message[]>;
  files: Record<string, StoredFile>;
  readCursors: Record<string, number>; // `${roomId}:${userId}` -> timestamp
}

const DEFAULT_AVATARS = [
  '/src/assets/images/avatar_preset_one_1795367488349.jpg',
  '/src/assets/images/avatar_preset_two_1795367488468.jpg',
  '/src/assets/images/avatar_preset_three_1795367488379.jpg',
];

function createInitialStore(): StoreData {
  const lobbyId = 'room_lobby';
  return {
    users: {},
    usernameIndex: {},
    rooms: {
      [lobbyId]: {
        id: lobbyId,
        type: 'group',
        name: 'JadeChat Lobby',
        avatarUrl: '',
        memberIds: [],
        createdBy: 'system',
        createdAt: Date.now(),
      },
    },
    messages: {
      [lobbyId]: [],
    },
    files: {},
    readCursors: {},
  };
}

function loadStore(): StoreData {
  if (!fs.existsSync(STORE_PATH)) {
    const initial = createInitialStore();
    fs.writeFileSync(STORE_PATH, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as StoreData;
    if (!parsed.rooms || !parsed.rooms.room_lobby) {
      const initial = createInitialStore();
      parsed.rooms = { ...initial.rooms, ...(parsed.rooms || {}) };
      parsed.messages = { ...initial.messages, ...(parsed.messages || {}) };
    }
    return {
      users: parsed.users || {},
      usernameIndex: parsed.usernameIndex || {},
      rooms: parsed.rooms || {},
      messages: parsed.messages || {},
      files: parsed.files || {},
      readCursors: parsed.readCursors || {},
    };
  } catch {
    return createInitialStore();
  }
}

const store: StoreData = loadStore();
let writePending = false;
let writeQueued = false;

function persistStore() {
  if (writePending) {
    writeQueued = true;
    return;
  }
  writePending = true;
  const snapshot = JSON.stringify(store);
  const tmpPath = `${STORE_PATH}.tmp`;
  fs.promises
    .writeFile(tmpPath, snapshot, 'utf8')
    .then(() => fs.promises.rename(tmpPath, STORE_PATH))
    .catch((err) => {
      console.error('Failed to persist store:', err);
    })
    .finally(() => {
      writePending = false;
      if (writeQueued) {
        writeQueued = false;
        persistStore();
      }
    });
}

// Password hashing & token helpers
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, expectedHex] = storedHash.split(':');
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

interface TokenPayload {
  uid: string;
  exp: number;
}

function signToken(userId: string): string {
  const payload: TokenPayload = {
    uid: userId,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${sig}`;
}

function verifyToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encodedPayload)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as TokenPayload;
    if (!decoded.uid || typeof decoded.exp !== 'number' || decoded.exp < Date.now()) {
      return null;
    }
    return store.users[decoded.uid] ? decoded.uid : null;
  } catch {
    return null;
  }
}

// Live WebSocket presence & call registry
const userSockets = new Map<string, Set<WebSocket>>();
interface ActiveCall {
  callId: string;
  roomId: string;
  callerId: string;
  calleeId: string;
  createdAt: number;
  connectedAt?: number;
}
const activeCalls = new Map<string, ActiveCall>();
const userActiveCall = new Map<string, string>(); // userId -> callId

function isUserOnline(userId: string): boolean {
  const set = userSockets.get(userId);
  return Boolean(set && set.size > 0);
}

function sanitizeUser(u: StoredUser): User {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    bio: u.bio,
    createdAt: u.createdAt,
    isOnline: isUserOnline(u.id),
    lastSeenAt: u.lastSeenAt,
  };
}

function sendWs(ws: WebSocket, event: WsServerEvent) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

function emitToUser(userId: string, event: WsServerEvent) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  const payload = JSON.stringify(event);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

function emitToRoom(roomId: string, event: WsServerEvent, excludeUserId?: string) {
  const room = store.rooms[roomId];
  if (!room) return;
  for (const memberId of room.memberIds) {
    if (excludeUserId && memberId === excludeUserId) continue;
    emitToUser(memberId, event);
  }
}

function broadcastAll(event: WsServerEvent, excludeUserId?: string) {
  const payload = JSON.stringify(event);
  for (const [uid, sockets] of userSockets.entries()) {
    if (excludeUserId && uid === excludeUserId) continue;
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }
}

function formatDuration(sec: number): string {
  const mins = Math.floor(sec / 60);
  const rem = Math.floor(sec % 60);
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function enrichRoomForUser(room: Room, viewerId: string): Room {
  const msgs = store.messages[room.id] || [];
  const lastMessage = msgs.length > 0 ? msgs[msgs.length - 1] : null;
  const cursor = store.readCursors[`${room.id}:${viewerId}`] || 0;
  let unreadCount = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.createdAt <= cursor) break;
    if (m.senderId !== viewerId) unreadCount++;
  }

  let name = room.name;
  let avatarUrl = room.avatarUrl;
  let peerUser: User | null = null;

  if (room.type === 'dm') {
    const peerId = room.memberIds.find((id) => id !== viewerId) || viewerId;
    const storedPeer = store.users[peerId];
    if (storedPeer) {
      peerUser = sanitizeUser(storedPeer);
      name = storedPeer.displayName;
      avatarUrl = storedPeer.avatarUrl;
    }
  }

  return {
    ...room,
    name,
    avatarUrl,
    lastMessage,
    unreadCount,
    peerUser,
  };
}

function isValidAvatarUrl(url: string): boolean {
  if (!url) return true;
  if (DEFAULT_AVATARS.includes(url)) return true;
  if (/^\/api\/files\/[a-zA-Z0-9_-]+$/.test(url)) return true;
  return false;
}

// Express App Setup
const app = express();
app.use(express.json({ limit: '1mb' }));

interface AuthenticatedRequest extends express.Request {
  userId?: string;
}

function requireAuth(
  req: AuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction
) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const token = header.slice(7).trim();
  const uid = verifyToken(token);
  if (!uid) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }
  req.userId = uid;
  next();
}

// Auth Endpoints
app.post('/api/auth/register', (req, res) => {
  const rawUsername = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const requestedAvatar = typeof req.body?.avatarUrl === 'string' ? req.body.avatarUrl.trim() : '';

  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(rawUsername)) {
    res.status(400).json({ error: 'Username must be 3-24 characters (letters, numbers, _, ., -).' });
    return;
  }
  if (displayName.length < 1 || displayName.length > 40) {
    res.status(400).json({ error: 'Display name must be between 1 and 40 characters.' });
    return;
  }
  if (password.length < 6 || password.length > 128) {
    res.status(400).json({ error: 'Password must be between 6 and 128 characters.' });
    return;
  }
  if (store.usernameIndex[rawUsername]) {
    res.status(409).json({ error: 'That username is already taken.' });
    return;
  }

  const avatarUrl = isValidAvatarUrl(requestedAvatar) && requestedAvatar
    ? requestedAvatar
    : DEFAULT_AVATARS[Object.keys(store.users).length % DEFAULT_AVATARS.length];

  const userId = `u_${crypto.randomUUID().slice(0, 12)}`;
  const now = Date.now();
  const newUser: StoredUser = {
    id: userId,
    username: rawUsername,
    displayName,
    avatarUrl,
    bio: 'Available on JadeChat',
    createdAt: now,
    lastSeenAt: now,
    passwordHash: hashPassword(password),
  };

  store.users[userId] = newUser;
  store.usernameIndex[rawUsername] = userId;

  // Add to workspace lobby room
  const lobby = store.rooms.room_lobby;
  if (lobby && !lobby.memberIds.includes(userId)) {
    lobby.memberIds.push(userId);
  }

  // Create user's personal Saved Notes room
  const notesRoomId = `notes_${userId}`;
  const notesRoom: Room = {
    id: notesRoomId,
    type: 'notes',
    name: 'Saved Notes',
    avatarUrl: '',
    memberIds: [userId],
    createdBy: userId,
    createdAt: now,
  };
  store.rooms[notesRoomId] = notesRoom;
  store.messages[notesRoomId] = [
    {
      id: `m_${crypto.randomUUID().slice(0, 12)}`,
      roomId: notesRoomId,
      senderId: userId,
      senderName: displayName,
      senderAvatar: avatarUrl,
      type: 'text',
      text: 'Welcome to your personal Saved Notes space. Drop files, voice memos, or quick reminders here.',
      createdAt: now,
    },
  ];
  store.readCursors[`${notesRoomId}:${userId}`] = now;
  store.readCursors[`room_lobby:${userId}`] = now;

  persistStore();

  const publicUser = sanitizeUser(newUser);
  const token = signToken(userId);

  broadcastAll({ type: 'user:registered', user: publicUser }, userId);
  if (lobby) {
    emitToRoom('room_lobby', { type: 'room:updated', room: lobby }, userId);
  }

  res.status(201).json({ token, user: publicUser });
});

app.post('/api/auth/login', (req, res) => {
  const rawUsername = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  const userId = store.usernameIndex[rawUsername];
  const storedUser = userId ? store.users[userId] : undefined;
  if (!storedUser || !verifyPassword(password, storedUser.passwordHash)) {
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }

  storedUser.lastSeenAt = Date.now();
  persistStore();

  const token = signToken(storedUser.id);
  res.json({ token, user: sanitizeUser(storedUser) });
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const storedUser = req.userId ? store.users[req.userId] : undefined;
  if (!storedUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({ user: sanitizeUser(storedUser) });
});

app.patch('/api/auth/profile', requireAuth, (req: AuthenticatedRequest, res) => {
  const storedUser = req.userId ? store.users[req.userId] : undefined;
  if (!storedUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (typeof req.body?.displayName === 'string') {
    const trimmed = req.body.displayName.trim();
    if (trimmed.length < 1 || trimmed.length > 40) {
      res.status(400).json({ error: 'Display name must be 1-40 characters.' });
      return;
    }
    storedUser.displayName = trimmed;
  }

  if (typeof req.body?.bio === 'string') {
    storedUser.bio = req.body.bio.trim().slice(0, 160);
  }

  if (typeof req.body?.avatarUrl === 'string') {
    const avatar = req.body.avatarUrl.trim();
    if (!isValidAvatarUrl(avatar)) {
      res.status(400).json({ error: 'Invalid avatar URL.' });
      return;
    }
    storedUser.avatarUrl = avatar;
  }

  persistStore();
  const updated = sanitizeUser(storedUser);
  broadcastAll({ type: 'user:updated', user: updated });
  res.json({ user: updated });
});

// Directory & Users
app.get('/api/users', requireAuth, (_req: AuthenticatedRequest, res) => {
  const users = Object.values(store.users).map(sanitizeUser);
  res.json({ users });
});

// Rooms & Conversations
app.get('/api/rooms', requireAuth, (req: AuthenticatedRequest, res) => {
  const uid = req.userId!;
  const rooms = Object.values(store.rooms)
    .filter((r) => r.memberIds.includes(uid))
    .map((r) => enrichRoomForUser(r, uid))
    .sort((a, b) => {
      const timeA = a.lastMessage?.createdAt ?? a.createdAt;
      const timeB = b.lastMessage?.createdAt ?? b.createdAt;
      return timeB - timeA;
    });
  res.json({ rooms });
});

app.post('/api/rooms/dm', requireAuth, (req: AuthenticatedRequest, res) => {
  const uid = req.userId!;
  const targetUserId = typeof req.body?.targetUserId === 'string' ? req.body.targetUserId.trim() : '';

  if (!targetUserId || !store.users[targetUserId]) {
    res.status(404).json({ error: 'Target user not found.' });
    return;
  }
  if (targetUserId === uid) {
    const notesRoom = store.rooms[`notes_${uid}`];
    if (notesRoom) {
      res.json({ room: enrichRoomForUser(notesRoom, uid) });
      return;
    }
  }

  // Check if DM already exists
  const existing = Object.values(store.rooms).find(
    (r) =>
      r.type === 'dm' &&
      r.memberIds.length === 2 &&
      r.memberIds.includes(uid) &&
      r.memberIds.includes(targetUserId)
  );
  if (existing) {
    res.json({ room: enrichRoomForUser(existing, uid) });
    return;
  }

  const now = Date.now();
  const roomId = `dm_${crypto.randomUUID().slice(0, 12)}`;
  const room: Room = {
    id: roomId,
    type: 'dm',
    name: store.users[targetUserId].displayName,
    avatarUrl: store.users[targetUserId].avatarUrl,
    memberIds: [uid, targetUserId],
    createdBy: uid,
    createdAt: now,
  };
  store.rooms[roomId] = room;
  store.messages[roomId] = [];
  persistStore();

  emitToUser(targetUserId, { type: 'room:created', room: enrichRoomForUser(room, targetUserId) });
  emitToUser(uid, { type: 'room:created', room: enrichRoomForUser(room, uid) });

  res.status(201).json({ room: enrichRoomForUser(room, uid) });
});

app.post('/api/rooms/group', requireAuth, (req: AuthenticatedRequest, res) => {
  const uid = req.userId!;
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const rawMembers = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];

  if (name.length < 1 || name.length > 50) {
    res.status(400).json({ error: 'Group name must be 1-50 characters.' });
    return;
  }

  const validMemberSet = new Set<string>([uid]);
  for (const id of rawMembers) {
    if (typeof id === 'string' && store.users[id]) {
      validMemberSet.add(id);
    }
  }
  const memberIds = Array.from(validMemberSet);
  const now = Date.now();
  const roomId = `grp_${crypto.randomUUID().slice(0, 12)}`;
  const creator = store.users[uid];

  const room: Room = {
    id: roomId,
    type: 'group',
    name,
    avatarUrl: '',
    memberIds,
    createdBy: uid,
    createdAt: now,
  };
  store.rooms[roomId] = room;
  store.messages[roomId] = [
    {
      id: `m_${crypto.randomUUID().slice(0, 12)}`,
      roomId,
      senderId: uid,
      senderName: creator.displayName,
      senderAvatar: creator.avatarUrl,
      type: 'text',
      text: `${creator.displayName} created group "${name}"`,
      createdAt: now,
    },
  ];
  store.readCursors[`${roomId}:${uid}`] = now;
  persistStore();

  for (const memberId of memberIds) {
    emitToUser(memberId, { type: 'room:created', room: enrichRoomForUser(room, memberId) });
  }

  res.status(201).json({ room: enrichRoomForUser(room, uid) });
});

app.post('/api/rooms/:roomId/members', requireAuth, (req: AuthenticatedRequest, res) => {
  const uid = req.userId!;
  const { roomId } = req.params;
  const room = store.rooms[roomId];
  if (!room || !room.memberIds.includes(uid)) {
    res.status(404).json({ error: 'Room not found.' });
    return;
  }
  if (room.type !== 'group') {
    res.status(400).json({ error: 'Members can only be added to group chats.' });
    return;
  }

  const rawMembers = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
  const added: string[] = [];
  for (const id of rawMembers) {
    if (typeof id === 'string' && store.users[id] && !room.memberIds.includes(id)) {
      room.memberIds.push(id);
      added.push(id);
    }
  }

  if (added.length > 0) {
    const names = added.map((id) => store.users[id]?.displayName || 'User').join(', ');
    const inviter = store.users[uid];
    const sysMsg: Message = {
      id: `m_${crypto.randomUUID().slice(0, 12)}`,
      roomId,
      senderId: uid,
      senderName: inviter.displayName,
      senderAvatar: inviter.avatarUrl,
      type: 'text',
      text: `${inviter.displayName} added ${names} to the group`,
      createdAt: Date.now(),
    };
    store.messages[roomId] = store.messages[roomId] || [];
    store.messages[roomId].push(sysMsg);
    persistStore();

    for (const memberId of room.memberIds) {
      if (added.includes(memberId)) {
        emitToUser(memberId, { type: 'room:created', room: enrichRoomForUser(room, memberId) });
      } else {
        emitToUser(memberId, { type: 'room:updated', room: enrichRoomForUser(room, memberId) });
        emitToUser(memberId, { type: 'message:created', message: sysMsg });
      }
    }
  }

  res.json({ room: enrichRoomForUser(room, uid) });
});

app.get('/api/rooms/:roomId/messages', requireAuth, (req: AuthenticatedRequest, res) => {
  const uid = req.userId!;
  const { roomId } = req.params;
  const room = store.rooms[roomId];
  if (!room || !room.memberIds.includes(uid)) {
    res.status(403).json({ error: 'Access denied to this conversation.' });
    return;
  }
  const all = store.messages[roomId] || [];
  const limit = Math.min(Number(req.query.limit) || 120, 300);
  const messages = all.slice(-limit);
  res.json({ messages });
});

app.get('/api/rooms/:roomId/files', requireAuth, (req: AuthenticatedRequest, res) => {
  const uid = req.userId!;
  const { roomId } = req.params;
  const room = store.rooms[roomId];
  if (!room || !room.memberIds.includes(uid)) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }
  const msgs = store.messages[roomId] || [];
  const files: FileAttachment[] = msgs
    .filter((m) => m.attachment && (m.type === 'file' || m.type === 'image' || m.type === 'voice'))
    .map((m) => ({
      ...m.attachment!,
      roomId: m.roomId,
      uploaderId: m.senderId,
      uploaderName: m.senderName,
      createdAt: m.createdAt,
    }))
    .reverse();
  res.json({ files });
});

app.get('/api/files/all', requireAuth, (req: AuthenticatedRequest, res) => {
  const uid = req.userId!;
  const files: FileAttachment[] = [];
  for (const room of Object.values(store.rooms)) {
    if (!room.memberIds.includes(uid)) continue;
    const msgs = store.messages[room.id] || [];
    for (const m of msgs) {
      if (m.attachment && (m.type === 'file' || m.type === 'image' || m.type === 'voice')) {
        files.push({
          ...m.attachment,
          roomId: room.id,
          uploaderId: m.senderId,
          uploaderName: m.senderName,
          createdAt: m.createdAt,
        });
      }
    }
  }
  files.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.json({ files });
});

// File Upload & Secure Download
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max
  },
});

app.post(
  '/api/upload',
  requireAuth,
  upload.single('file'),
  (req: AuthenticatedRequest, res) => {
    const uid = req.userId!;
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file provided.' });
      return;
    }

    const roomId = typeof req.body?.roomId === 'string' ? req.body.roomId.trim() : '';
    const durationRaw = Number(req.body?.durationSec);
    const durationSec = Number.isFinite(durationRaw) && durationRaw > 0 ? Math.round(durationRaw) : undefined;

    if (roomId !== 'avatar') {
      const room = store.rooms[roomId];
      if (!room || !room.memberIds.includes(uid)) {
        // Delete unowned uploaded file
        fs.promises.unlink(file.path).catch(() => {});
        res.status(403).json({ error: 'Access denied for target conversation.' });
        return;
      }
    }

    const fileId = `f_${crypto.randomUUID().slice(0, 14)}`;
    const originalName = path.basename(file.originalname || 'attachment').slice(0, 160);
    const mimeType = file.mimetype || 'application/octet-stream';

    const record: StoredFile = {
      id: fileId,
      diskName: file.filename,
      originalName,
      mimeType,
      size: file.size,
      uploaderId: uid,
      roomId,
      durationSec,
      createdAt: Date.now(),
    };
    store.files[fileId] = record;
    persistStore();

    const attachment: FileAttachment = {
      id: fileId,
      name: originalName,
      mimeType,
      size: file.size,
      url: `/api/files/${fileId}`,
      durationSec,
      roomId,
      uploaderId: uid,
      uploaderName: store.users[uid]?.displayName,
      createdAt: record.createdAt,
    };

    res.status(201).json({ file: attachment });
  }
);

app.get('/api/files/:fileId', requireAuth, (req: AuthenticatedRequest, res) => {
  const uid = req.userId!;
  const { fileId } = req.params;
  const record = store.files[fileId];
  if (!record) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }

  if (record.roomId !== 'avatar') {
    const room = store.rooms[record.roomId];
    if (!room || !room.memberIds.includes(uid)) {
      res.status(403).json({ error: 'Access denied to this file.' });
      return;
    }
  }

  const resolvedPath = path.resolve(UPLOADS_DIR, record.diskName);
  if (!resolvedPath.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(resolvedPath)) {
    res.status(404).json({ error: 'File content missing.' });
    return;
  }

  const isInlineSafe =
    record.mimeType.startsWith('image/') && record.mimeType !== 'image/svg+xml'
      ? true
      : record.mimeType.startsWith('audio/') || record.mimeType === 'application/pdf';

  const forceDownload = req.query.download === '1';
  const safeName = record.originalName.replace(/["\r\n]/g, '_');

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', record.mimeType);
  res.setHeader(
    'Content-Disposition',
    `${isInlineSafe && !forceDownload ? 'inline' : 'attachment'}; filename="${safeName}"`
  );
  res.sendFile(resolvedPath);
});

// Multer error handler
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (err instanceof multer.MulterError) {
      res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds 25MB limit.' : err.message });
      return;
    }
    next(err);
  }
);

// HTTP & WebSocket Server
const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

interface AuthedWebSocket extends WebSocket {
  userId?: string;
  isAlive?: boolean;
}

function endCall(callId: string, reason: string) {
  const call = activeCalls.get(callId);
  if (!call) return;
  activeCalls.delete(callId);
  if (userActiveCall.get(call.callerId) === callId) userActiveCall.delete(call.callerId);
  if (userActiveCall.get(call.calleeId) === callId) userActiveCall.delete(call.calleeId);

  const durationSec = call.connectedAt
    ? Math.max(1, Math.round((Date.now() - call.connectedAt) / 1000))
    : undefined;

  emitToUser(call.callerId, {
    type: 'call:ended',
    callId,
    roomId: call.roomId,
    reason,
    durationSec,
  });
  emitToUser(call.calleeId, {
    type: 'call:ended',
    callId,
    roomId: call.roomId,
    reason,
    durationSec,
  });

  // Record system call summary message in the room
  const caller = store.users[call.callerId];
  const room = store.rooms[call.roomId];
  if (caller && room) {
    let summary = 'Voice call ended';
    if (durationSec !== undefined) {
      summary = `Voice call · ${formatDuration(durationSec)}`;
    } else if (reason === 'rejected') {
      summary = 'Voice call declined';
    } else if (reason === 'offline') {
      summary = 'Missed voice call (recipient offline)';
    } else if (reason === 'cancelled' || reason === 'missed') {
      summary = 'Missed voice call';
    }

    const callMsg: Message = {
      id: `m_${crypto.randomUUID().slice(0, 12)}`,
      roomId: call.roomId,
      senderId: caller.id,
      senderName: caller.displayName,
      senderAvatar: caller.avatarUrl,
      type: 'call',
      text: summary,
      createdAt: Date.now(),
    };
    store.messages[call.roomId] = store.messages[call.roomId] || [];
    store.messages[call.roomId].push(callMsg);
    persistStore();
    emitToRoom(call.roomId, { type: 'message:created', message: callMsg });
  }
}

wss.on('connection', (ws: AuthedWebSocket) => {
  ws.isAlive = true;

  const authTimer = setTimeout(() => {
    if (!ws.userId) {
      sendWs(ws, { type: 'auth:error', error: 'Authentication timeout' });
      ws.close();
    }
  }, 6000);

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (rawData) => {
    let event: WsClientEvent;
    try {
      event = JSON.parse(rawData.toString('utf8')) as WsClientEvent;
    } catch {
      return;
    }

    if (event.type === 'auth') {
      const uid = verifyToken(event.token);
      if (!uid) {
        sendWs(ws, { type: 'auth:error', error: 'Invalid session token' });
        ws.close();
        return;
      }
      clearTimeout(authTimer);
      ws.userId = uid;

      const wasOnline = isUserOnline(uid);
      let set = userSockets.get(uid);
      if (!set) {
        set = new Set();
        userSockets.set(uid, set);
      }
      set.add(ws);

      const onlineUserIds = Array.from(userSockets.keys()).filter((id) => isUserOnline(id));
      sendWs(ws, { type: 'auth:ok', userId: uid, onlineUserIds });

      if (!wasOnline) {
        const now = Date.now();
        if (store.users[uid]) {
          store.users[uid].lastSeenAt = now;
        }
        broadcastAll({ type: 'presence:update', userId: uid, isOnline: true, lastSeenAt: now }, uid);
      }
      return;
    }

    const uid = ws.userId;
    if (!uid) {
      sendWs(ws, { type: 'error', message: 'Not authenticated' });
      return;
    }
    const sender = store.users[uid];
    if (!sender) return;

    switch (event.type) {
      case 'message:send': {
        const room = store.rooms[event.roomId];
        if (!room || !room.memberIds.includes(uid)) {
          sendWs(ws, { type: 'error', message: 'Not a member of this conversation' });
          return;
        }
        const allowedTypes: MessageType[] = ['text', 'file', 'image', 'voice'];
        const messageType: MessageType = allowedTypes.includes(event.messageType) ? event.messageType : 'text';
        const text = typeof event.text === 'string' ? event.text.trim().slice(0, 4000) : '';
        if (!text && !event.attachment) return;

        let validatedAttachment: FileAttachment | undefined;
        if (event.attachment && event.attachment.id) {
          const storedFile = store.files[event.attachment.id];
          if (storedFile && storedFile.roomId === event.roomId) {
            validatedAttachment = {
              id: storedFile.id,
              name: storedFile.originalName,
              mimeType: storedFile.mimeType,
              size: storedFile.size,
              url: `/api/files/${storedFile.id}`,
              durationSec: storedFile.durationSec,
            };
          }
        }

        let replyTo: MessageReply | undefined;
        if (event.replyTo && event.replyTo.id) {
          replyTo = {
            id: String(event.replyTo.id).slice(0, 64),
            senderName: String(event.replyTo.senderName || 'User').slice(0, 40),
            text: String(event.replyTo.text || '').slice(0, 140),
          };
        }

        const now = Date.now();
        const msg: Message = {
          id: `m_${crypto.randomUUID().slice(0, 12)}`,
          clientTempId: event.clientTempId,
          roomId: event.roomId,
          senderId: uid,
          senderName: sender.displayName,
          senderAvatar: sender.avatarUrl,
          type: messageType,
          text,
          attachment: validatedAttachment,
          replyTo,
          reactions: {},
          readBy: [uid],
          createdAt: now,
        };

        store.messages[event.roomId] = store.messages[event.roomId] || [];
        store.messages[event.roomId].push(msg);
        if (store.messages[event.roomId].length > 500) {
          store.messages[event.roomId] = store.messages[event.roomId].slice(-500);
        }
        store.readCursors[`${event.roomId}:${uid}`] = now;
        persistStore();

        emitToRoom(event.roomId, { type: 'message:created', message: msg });
        break;
      }

      case 'message:react': {
        const room = store.rooms[event.roomId];
        if (!room || !room.memberIds.includes(uid)) return;
        const msgs = store.messages[event.roomId] || [];
        const target = msgs.find((m) => m.id === event.messageId);
        if (!target) return;

        const emoji = String(event.emoji || '').slice(0, 8);
        if (!emoji) return;
        target.reactions = target.reactions || {};
        const users = target.reactions[emoji] || [];
        if (users.includes(uid)) {
          target.reactions[emoji] = users.filter((id) => id !== uid);
          if (target.reactions[emoji].length === 0) delete target.reactions[emoji];
        } else {
          target.reactions[emoji] = [...users, uid];
        }
        persistStore();

        emitToRoom(event.roomId, {
          type: 'message:reaction_updated',
          roomId: event.roomId,
          messageId: event.messageId,
          reactions: target.reactions,
        });
        break;
      }

      case 'message:read': {
        const room = store.rooms[event.roomId];
        if (!room || !room.memberIds.includes(uid)) return;
        const ts = typeof event.timestamp === 'number' ? event.timestamp : Date.now();
        store.readCursors[`${event.roomId}:${uid}`] = Math.max(
          store.readCursors[`${event.roomId}:${uid}`] || 0,
          ts
        );
        const msgs = store.messages[event.roomId] || [];
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (m.createdAt > ts) continue;
          m.readBy = m.readBy || [];
          if (!m.readBy.includes(uid)) {
            m.readBy.push(uid);
          } else {
            break;
          }
        }
        persistStore();
        emitToRoom(
          event.roomId,
          { type: 'message:read_updated', roomId: event.roomId, userId: uid, timestamp: ts },
          uid
        );
        break;
      }

      case 'typing:start':
      case 'typing:stop': {
        const room = store.rooms[event.roomId];
        if (!room || !room.memberIds.includes(uid)) return;
        emitToRoom(
          event.roomId,
          {
            type: 'typing:update',
            roomId: event.roomId,
            userId: uid,
            displayName: sender.displayName,
            isTyping: event.type === 'typing:start',
          },
          uid
        );
        break;
      }

      // WebRTC Voice Call Signaling
      case 'call:invite': {
        const room = store.rooms[event.roomId];
        if (!room || !room.memberIds.includes(uid) || !room.memberIds.includes(event.calleeId)) {
          sendWs(ws, { type: 'error', message: 'Invalid call participants' });
          return;
        }
        if (event.calleeId === uid) return;

        if (!isUserOnline(event.calleeId)) {
          activeCalls.set(event.callId, {
            callId: event.callId,
            roomId: event.roomId,
            callerId: uid,
            calleeId: event.calleeId,
            createdAt: Date.now(),
          });
          endCall(event.callId, 'offline');
          return;
        }

        if (userActiveCall.has(event.calleeId)) {
          sendWs(ws, { type: 'call:busy', callId: event.callId, calleeId: event.calleeId });
          return;
        }

        const call: ActiveCall = {
          callId: event.callId,
          roomId: event.roomId,
          callerId: uid,
          calleeId: event.calleeId,
          createdAt: Date.now(),
        };
        activeCalls.set(event.callId, call);
        userActiveCall.set(uid, event.callId);
        userActiveCall.set(event.calleeId, event.callId);

        sendWs(ws, { type: 'call:ringing', callId: event.callId, calleeId: event.calleeId });
        emitToUser(event.calleeId, {
          type: 'call:incoming',
          callId: event.callId,
          roomId: event.roomId,
          caller: sanitizeUser(sender),
        });
        break;
      }

      case 'call:accept': {
        const call = activeCalls.get(event.callId);
        if (!call || call.calleeId !== uid) return;
        call.connectedAt = Date.now();
        emitToUser(call.callerId, {
          type: 'call:accepted',
          callId: event.callId,
          roomId: call.roomId,
          calleeId: uid,
        });
        break;
      }

      case 'call:reject': {
        const call = activeCalls.get(event.callId);
        if (!call || (call.calleeId !== uid && call.callerId !== uid)) return;
        emitToUser(call.callerId, {
          type: 'call:rejected',
          callId: event.callId,
          roomId: call.roomId,
          reason: event.reason || 'rejected',
        });
        endCall(event.callId, event.reason || 'rejected');
        break;
      }

      case 'call:offer': {
        const call = activeCalls.get(event.callId);
        if (!call || (call.callerId !== uid && call.calleeId !== uid)) return;
        emitToUser(event.targetUserId, {
          type: 'call:offer',
          callId: event.callId,
          roomId: call.roomId,
          fromUserId: uid,
          sdp: event.sdp,
        });
        break;
      }

      case 'call:answer': {
        const call = activeCalls.get(event.callId);
        if (!call || (call.callerId !== uid && call.calleeId !== uid)) return;
        if (!call.connectedAt) call.connectedAt = Date.now();
        emitToUser(event.targetUserId, {
          type: 'call:answer',
          callId: event.callId,
          roomId: call.roomId,
          fromUserId: uid,
          sdp: event.sdp,
        });
        break;
      }

      case 'call:ice': {
        const call = activeCalls.get(event.callId);
        if (!call || (call.callerId !== uid && call.calleeId !== uid)) return;
        emitToUser(event.targetUserId, {
          type: 'call:ice',
          callId: event.callId,
          roomId: call.roomId,
          fromUserId: uid,
          candidate: event.candidate,
        });
        break;
      }

      case 'call:hangup': {
        const call = activeCalls.get(event.callId);
        if (!call || (call.callerId !== uid && call.calleeId !== uid)) return;
        const reason = call.connectedAt ? 'completed' : 'cancelled';
        endCall(event.callId, reason);
        break;
      }
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimer);
    const uid = ws.userId;
    if (!uid) return;
    const set = userSockets.get(uid);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        userSockets.delete(uid);
        const now = Date.now();
        if (store.users[uid]) {
          store.users[uid].lastSeenAt = now;
        }
        broadcastAll({ type: 'presence:update', userId: uid, isOnline: false, lastSeenAt: now });

        const ongoingCallId = userActiveCall.get(uid);
        if (ongoingCallId) {
          endCall(ongoingCallId, 'disconnected');
        }
      }
    }
  });
});

// Keepalive interval
const pingInterval = setInterval(() => {
  for (const client of wss.clients) {
    const c = client as AuthedWebSocket;
    if (c.isAlive === false) {
      c.terminate();
      continue;
    }
    c.isAlive = false;
    c.ping();
  }
}, 30000);

wss.on('close', () => {
  clearInterval(pingInterval);
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`JadeChat server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
