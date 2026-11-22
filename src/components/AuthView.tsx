import { FormEvent, useState } from 'react';
import { MessageSquare, PhoneCall, FolderUp, Moon, Sun } from 'lucide-react';
import { apiRequest, setAuthToken } from '../lib/api';
import type { User } from '../types';

const AVATAR_PRESETS = [
  {
    label: 'Sage Ceramic',
    url: '/src/assets/images/avatar_preset_one_1795367488349.jpg',
  },
  {
    label: 'Brushed Steel',
    url: '/src/assets/images/avatar_preset_two_1795367488468.jpg',
  },
  {
    label: 'Travertine Arch',
    url: '/src/assets/images/avatar_preset_three_1795367488379.jpg',
  },
];

interface AuthViewProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onAuthenticated: (user: User, token: string) => void;
}

export function AuthView({ darkMode, onToggleDarkMode, onAuthenticated }: AuthViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(AVATAR_PRESETS[0].url);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const body =
        mode === 'register'
          ? { username, displayName, password, avatarUrl: selectedAvatar }
          : { username, password };

      const res = await apiRequest<{ token: string; user: User }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      setAuthToken(res.token);
      onAuthenticated(res.user, res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F6F8] dark:bg-[#0B0E14] text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Clean 3-zone header */}
      <header className="w-full max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-8">
        <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
          <div className="w-8 h-8 rounded-xl bg-[#058A45] text-white flex items-center justify-center font-display font-bold text-sm">
            J
          </div>
          <span className="font-display text-lg font-bold tracking-tight">JadeChat</span>
        </div>

        <nav className="hidden md:flex items-center gap-6 text-sm text-slate-600 dark:text-slate-400">
          <span className="whitespace-nowrap shrink-0">Real-Time Messaging</span>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap shrink-0">File Sharing</span>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap shrink-0">Voice Calling</span>
        </nav>

        <button
          type="button"
          onClick={onToggleDarkMode}
          aria-label="Toggle color theme"
          className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
        >
          {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
        {/* Left editorial showcase */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          <div className="space-y-4">
            <h1 className="font-display text-3xl sm:text-5xl font-bold tracking-tight text-slate-900 dark:text-white leading-[1.12] [text-wrap:balance]">
              Direct messaging, shared files, and live voice calls in one calm workspace.
            </h1>
            <p className="text-base text-slate-600 dark:text-slate-400 max-w-xl leading-relaxed">
              Connect instantly over WebSockets, transfer documents up to 25 MB, send voice notes, and place peer-to-peer WebRTC audio calls across tabs or devices.
            </p>
          </div>

          <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <img
              src="/src/assets/images/welcome_chat_illustration_1795367489292.jpg"
              alt="JadeChat connected architectural workspace visual"
              referrerPolicy="no-referrer"
              className="w-full h-56 sm:h-72 object-cover"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <MessageSquare className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Live Sync</h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Instant delivery, typing status, and read receipts.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <FolderUp className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">File Vault</h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Drag-and-drop uploads with inline previews.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <PhoneCall className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Voice Calls</h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Peer-to-peer WebRTC audio and voice notes.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right sign-in / registration card */}
        <div className="lg:col-span-5">
          <div className="bg-white dark:bg-[#131720] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8">
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-xl mb-6">
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  mode === 'register'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Create Account
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  mode === 'login'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Sign In
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="auth-username"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Username
                </label>
                <input
                  id="auth-username"
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. alex.chen"
                  autoComplete="username"
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              {mode === 'register' && (
                <div>
                  <label
                    htmlFor="auth-displayname"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Display Name
                  </label>
                  <input
                    id="auth-displayname"
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Alex Chen"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="auth-password"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Password
                </label>
                <input
                  id="auth-password"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              {mode === 'register' && (
                <div>
                  <span className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Choose Avatar
                  </span>
                  <div className="grid grid-cols-3 gap-2.5">
                    {AVATAR_PRESETS.map((preset) => {
                      const active = selectedAvatar === preset.url;
                      return (
                        <button
                          key={preset.url}
                          type="button"
                          onClick={() => setSelectedAvatar(preset.url)}
                          className={`p-2 rounded-xl border text-center transition-colors ${
                            active
                              ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40'
                              : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                          }`}
                        >
                          <img
                            src={preset.url}
                            alt={preset.label}
                            referrerPolicy="no-referrer"
                            className="w-11 h-11 rounded-lg object-cover mx-auto mb-1"
                          />
                          <span className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 truncate">
                            {preset.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300"
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-xl bg-[#058A45] hover:bg-[#047339] disabled:opacity-60 text-white font-medium text-sm transition-colors cursor-pointer"
              >
                {submitting
                  ? 'Please wait...'
                  : mode === 'register'
                    ? 'Join JadeChat'
                    : 'Sign In to Workspace'}
              </button>
            </form>

            <p className="mt-5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Tip: Open a second browser tab to register another user and test live WebSocket messaging, file sharing, and WebRTC voice calling.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
