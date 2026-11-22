import { useEffect, useState } from 'react';
import { Users, Bookmark } from 'lucide-react';
import { fetchAuthenticatedMediaUrl } from '../lib/api';

interface AvatarProps {
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  isOnline?: boolean;
  showOnline?: boolean;
  kind?: 'user' | 'group' | 'notes';
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-lg',
};

const TINTS = [
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
  'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function Avatar({
  name,
  src,
  size = 'md',
  isOnline = false,
  showOnline = false,
  kind = 'user',
}: AvatarProps) {
  const [resolvedSrc, setResolvedSrc] = useState<string>('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!src) {
      setResolvedSrc('');
      return;
    }
    if (src.startsWith('/api/files/')) {
      let cancelled = false;
      fetchAuthenticatedMediaUrl(src)
        .then((objUrl) => {
          if (!cancelled) setResolvedSrc(objUrl);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
      return () => {
        cancelled = true;
      };
    }
    setResolvedSrc(src);
  }, [src]);

  const tintIdx = name.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % TINTS.length;
  const sizeClass = SIZE_CLASSES[size];

  return (
    <div className={`relative inline-flex shrink-0 ${sizeClass}`}>
      {kind === 'notes' ? (
        <div className="w-full h-full rounded-xl bg-emerald-700 text-white flex items-center justify-center">
          <Bookmark className="w-4 h-4" />
        </div>
      ) : kind === 'group' && !resolvedSrc ? (
        <div className="w-full h-full rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center border border-slate-300/60 dark:border-slate-700/60">
          <Users className="w-4 h-4" />
        </div>
      ) : resolvedSrc && !failed ? (
        <img
          src={resolvedSrc}
          alt={`${name} avatar`}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="w-full h-full rounded-xl object-cover border border-slate-200/80 dark:border-slate-700/80"
        />
      ) : (
        <div
          className={`w-full h-full rounded-xl flex items-center justify-center font-semibold tracking-tight ${TINTS[tintIdx]}`}
        >
          {getInitials(name)}
        </div>
      )}

      {showOnline && isOnline && (
        <span
          title="Online"
          className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900"
        />
      )}
    </div>
  );
}
