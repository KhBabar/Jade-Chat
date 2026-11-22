export type MessageType = 'text' | 'file' | 'image' | 'voice' | 'call';

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
  createdAt: number;
  isOnline?: boolean;
  lastSeenAt?: number;
}

export interface FileAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  durationSec?: number;
  roomId?: string;
  uploaderId?: string;
  uploaderName?: string;
  createdAt?: number;
}

export interface MessageReply {
  id: string;
  senderName: string;
  text: string;
}

export interface Message {
  id: string;
  clientTempId?: string;
  roomId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  type: MessageType;
  text: string;
  attachment?: FileAttachment;
  replyTo?: MessageReply;
  reactions?: Record<string, string[]>;
  readBy?: string[];
  createdAt: number;
}

export interface Room {
  id: string;
  type: 'dm' | 'group' | 'notes';
  name: string;
  avatarUrl: string;
  memberIds: string[];
  createdBy: string;
  createdAt: number;
  lastMessage?: Message | null;
  unreadCount?: number;
  peerUser?: User | null;
}

export interface CallInvitePayload {
  callId: string;
  roomId: string;
  calleeId: string;
}

export interface CallSignalPayload {
  callId: string;
  roomId: string;
  targetUserId: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export type WsClientEvent =
  | { type: 'auth'; token: string }
  | {
      type: 'message:send';
      clientTempId: string;
      roomId: string;
      messageType: MessageType;
      text: string;
      attachment?: FileAttachment;
      replyTo?: MessageReply;
    }
  | { type: 'message:react'; roomId: string; messageId: string; emoji: string }
  | { type: 'message:read'; roomId: string; timestamp: number }
  | { type: 'typing:start'; roomId: string }
  | { type: 'typing:stop'; roomId: string }
  | { type: 'call:invite'; callId: string; roomId: string; calleeId: string }
  | { type: 'call:accept'; callId: string; roomId: string; callerId: string }
  | { type: 'call:reject'; callId: string; roomId: string; callerId: string; reason?: string }
  | { type: 'call:offer'; callId: string; roomId: string; targetUserId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'call:answer'; callId: string; roomId: string; targetUserId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'call:ice'; callId: string; roomId: string; targetUserId: string; candidate: RTCIceCandidateInit }
  | { type: 'call:hangup'; callId: string; roomId: string; targetUserId: string };

export type WsServerEvent =
  | { type: 'auth:ok'; userId: string; onlineUserIds: string[] }
  | { type: 'auth:error'; error: string }
  | { type: 'presence:update'; userId: string; isOnline: boolean; lastSeenAt: number }
  | { type: 'user:registered'; user: User }
  | { type: 'user:updated'; user: User }
  | { type: 'room:created'; room: Room }
  | { type: 'room:updated'; room: Room }
  | { type: 'message:created'; message: Message }
  | { type: 'message:reaction_updated'; roomId: string; messageId: string; reactions: Record<string, string[]> }
  | { type: 'message:read_updated'; roomId: string; userId: string; timestamp: number }
  | { type: 'typing:update'; roomId: string; userId: string; displayName: string; isTyping: boolean }
  | {
      type: 'call:incoming';
      callId: string;
      roomId: string;
      caller: User;
    }
  | { type: 'call:ringing'; callId: string; calleeId: string }
  | { type: 'call:accepted'; callId: string; roomId: string; calleeId: string }
  | { type: 'call:rejected'; callId: string; roomId: string; reason: string }
  | { type: 'call:busy'; callId: string; calleeId: string }
  | { type: 'call:offer'; callId: string; roomId: string; fromUserId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'call:answer'; callId: string; roomId: string; fromUserId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'call:ice'; callId: string; roomId: string; fromUserId: string; candidate: RTCIceCandidateInit }
  | { type: 'call:ended'; callId: string; roomId: string; reason: string; durationSec?: number }
  | { type: 'error'; message: string };
