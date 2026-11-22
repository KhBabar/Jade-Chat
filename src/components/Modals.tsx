import { ChangeEvent, FormEvent, useState } from 'react';
import { Check, Upload, X } from 'lucide-react';
import { apiRequest, downloadAuthenticatedFile, uploadFile } from '../lib/api';
import type { Room, User } from '../types';
import { Avatar } from './Avatar';

const AVATAR_PRESETS = [
  '/src/assets/images/avatar_preset_one_1795367488349.jpg',
  '/src/assets/images/avatar_preset_two_1795367488468.jpg',
  '/src/assets/images/avatar_preset_three_1795367488379.jpg',
];

interface NewGroupModalProps {
  users: User[];
  currentUserId: string;
  onClose: () => void;
  onCreated: (room: Room) => void;
}

export function NewGroupModal({
  users,
  currentUserId,
  onClose,
  onCreated,
}: NewGroupModalProps) {
  const [name, setName] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = users.filter((u) => u.id !== currentUserId);

  const toggleUser = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiRequest<{ room: Room }>('/api/rooms/group', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), memberIds: selectedIds }),
      });
      onCreated(res.room);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-[#131720] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            New Group Chat
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label
              htmlFor="group-name-input"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Group Name
            </label>
            <input
              id="group-name-input"
              type="text"
              required
              maxLength={50}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Product Launch Team"
              className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
              Select Members ({selectedIds.length})
            </span>
            <div className="max-h-56 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
              {candidates.length === 0 ? (
                <p className="p-4 text-xs text-slate-500 dark:text-slate-400 text-center">
                  No other registered users yet. You can create the group now and invite members later.
                </p>
              ) : (
                candidates.map((u) => {
                  const selected = selectedIds.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => toggleUser(u.id)}
                      className="w-full px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-left transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar
                          name={u.displayName}
                          src={u.avatarUrl}
                          size="sm"
                          isOnline={u.isOnline}
                          showOnline
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                            {u.displayName}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                            @{u.username}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`w-5 h-5 rounded-md flex items-center justify-center border shrink-0 ${
                          selected
                            ? 'bg-[#058A45] border-[#058A45] text-white'
                            : 'border-slate-300 dark:border-slate-600'
                        }`}
                      >
                        {selected && <Check className="w-3.5 h-3.5" />}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="px-4 py-2 text-xs font-medium rounded-xl bg-[#058A45] hover:bg-[#047339] disabled:opacity-50 text-white"
            >
              {submitting ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface AddMembersModalProps {
  room: Room;
  users: User[];
  onClose: () => void;
  onUpdated: (room: Room) => void;
}

export function AddMembersModal({
  room,
  users,
  onClose,
  onUpdated,
}: AddMembersModalProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const candidates = users.filter((u) => !room.memberIds.includes(u.id));

  const toggleUser = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (selectedIds.length === 0) return;
    setSubmitting(true);
    try {
      const res = await apiRequest<{ room: Room }>(`/api/rooms/${room.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ memberIds: selectedIds }),
      });
      onUpdated(res.room);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-[#131720] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white truncate">
            Add Members to {room.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleAdd} className="p-5 space-y-4">
          <div className="max-h-64 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
            {candidates.length === 0 ? (
              <p className="p-4 text-xs text-slate-500 dark:text-slate-400 text-center">
                All registered users are already members of this group.
              </p>
            ) : (
              candidates.map((u) => {
                const selected = selectedIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggleUser(u.id)}
                    className="w-full px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={u.displayName} src={u.avatarUrl} size="sm" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          {u.displayName}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          @{u.username}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`w-5 h-5 rounded-md flex items-center justify-center border shrink-0 ${
                        selected
                          ? 'bg-[#058A45] border-[#058A45] text-white'
                          : 'border-slate-300 dark:border-slate-600'
                      }`}
                    >
                      {selected && <Check className="w-3.5 h-3.5" />}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || selectedIds.length === 0}
              className="px-4 py-2 text-xs font-medium rounded-xl bg-[#058A45] hover:bg-[#047339] disabled:opacity-50 text-white"
            >
              {submitting ? 'Adding...' : 'Add Selected'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface ProfileModalProps {
  user: User;
  onClose: () => void;
  onUpdated: (user: User) => void;
}

export function ProfileModal({ user, onClose, onUpdated }: ProfileModalProps) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAvatarUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadFile(file, file.name, 'avatar');
      setAvatarUrl(uploaded.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload avatar.');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiRequest<{ user: User }>('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ displayName, bio, avatarUrl }),
      });
      onUpdated(res.user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-[#131720] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Profile Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-4">
          <div className="flex items-center gap-4">
            <Avatar name={displayName || user.displayName} src={avatarUrl} size="xl" />
            <div className="space-y-1.5">
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                @{user.username}
              </p>
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>{uploading ? 'Uploading...' : 'Upload Photo'}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {AVATAR_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAvatarUrl(preset)}
                className={`p-1 rounded-xl border ${
                  avatarUrl === preset
                    ? 'border-emerald-600'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <img
                  src={preset}
                  alt="Avatar preset"
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-lg object-cover"
                />
              </button>
            ))}
          </div>

          <div>
            <label
              htmlFor="profile-display-name"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Display Name
            </label>
            <input
              id="profile-display-name"
              type="text"
              required
              maxLength={40}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div>
            <label
              htmlFor="profile-bio"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Status Bio
            </label>
            <input
              id="profile-bio"
              type="text"
              maxLength={160}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="What are you working on?"
              className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || uploading}
              className="px-4 py-2 text-xs font-medium rounded-xl bg-[#058A45] hover:bg-[#047339] disabled:opacity-50 text-white"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface LightboxModalProps {
  src: string;
  originalUrl: string;
  filename: string;
  onClose: () => void;
}

export function LightboxModal({
  src,
  originalUrl,
  filename,
  onClose,
}: LightboxModalProps) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex flex-col items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl flex items-center justify-between text-white mb-3 px-2"
      >
        <span className="text-sm font-medium truncate">{filename}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => downloadAuthenticatedFile(originalUrl, filename)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/15 hover:bg-white/25 transition-colors"
          >
            Download
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="p-2 rounded-lg bg-white/15 hover:bg-white/25 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <img
        src={src}
        alt={filename}
        referrerPolicy="no-referrer"
        onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-[82vh] rounded-xl object-contain"
      />
    </div>
  );
}
