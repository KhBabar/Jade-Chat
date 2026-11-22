import { useEffect, useRef, useState } from 'react';
import { Download, FileText, Image as ImageIcon, Pause, Play } from 'lucide-react';
import {
  downloadAuthenticatedFile,
  fetchAuthenticatedMediaUrl,
  formatDuration,
} from '../lib/api';

interface AuthImageProps {
  url: string;
  alt: string;
  className?: string;
  onClick?: (resolvedSrc: string) => void;
}

export function AuthImage({ url, alt, className = '', onClick }: AuthImageProps) {
  const [src, setSrc] = useState<string>('');
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    fetchAuthenticatedMediaUrl(url)
      .then((objUrl) => {
        if (!cancelled) setSrc(objUrl);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300">
        <ImageIcon className="w-4 h-4 shrink-0" />
        <span className="truncate">{alt}</span>
      </div>
    );
  }

  if (!src) {
    return (
      <div className="w-56 h-40 rounded-xl bg-slate-200/70 dark:bg-slate-800/70 animate-pulse" />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onClick={() => onClick?.(src)}
      className={`${className} ${onClick ? 'cursor-zoom-in' : ''}`}
    />
  );
}

interface AuthAudioPlayerProps {
  url: string;
  durationSec?: number;
  isOwn?: boolean;
}

export function AuthAudioPlayer({ url, durationSec = 0, isOwn = false }: AuthAudioPlayerProps) {
  const [src, setSrc] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(durationSec);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleToggle = async () => {
    if (!src) {
      setLoading(true);
      try {
        const objUrl = await fetchAuthenticatedMediaUrl(url);
        setSrc(objUrl);
        setLoading(false);
        setTimeout(() => {
          audioRef.current?.play().catch(() => {});
        }, 30);
      } catch {
        setLoading(false);
      }
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  };

  const progress =
    totalDuration > 0 ? Math.min(100, Math.round((currentTime / totalDuration) * 100)) : 0;

  return (
    <div className="flex items-center gap-3 min-w-[200px] sm:min-w-[240px]">
      {src && (
        <audio
          ref={audioRef}
          src={src}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            setCurrentTime(0);
          }}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setTotalDuration(Math.round(d));
          }}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        />
      )}

      <button
        type="button"
        onClick={handleToggle}
        aria-label={isPlaying ? 'Pause voice message' : 'Play voice message'}
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors ${
          isOwn
            ? 'bg-emerald-700 text-white hover:bg-emerald-800'
            : 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-300 dark:hover:bg-slate-600'
        }`}
      >
        {loading ? (
          <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : isPlaying ? (
          <Pause className="w-4 h-4" />
        ) : (
          <Play className="w-4 h-4 ml-0.5" />
        )}
      </button>

      <div className="flex-1 flex flex-col gap-1.5">
        <div
          className={`h-1.5 w-full rounded-full overflow-hidden ${
            isOwn ? 'bg-emerald-950/15 dark:bg-emerald-950/50' : 'bg-slate-200 dark:bg-slate-700'
          }`}
        >
          <div
            className={`h-full transition-all duration-100 ${
              isOwn ? 'bg-emerald-700 dark:bg-emerald-400' : 'bg-emerald-600 dark:bg-emerald-400'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] font-mono tabular-nums opacity-75">
          <span>Voice note</span>
          <span>{formatDuration(isPlaying ? Math.round(currentTime) : totalDuration)}</span>
        </div>
      </div>
    </div>
  );
}

interface AuthDownloadButtonProps {
  url: string;
  filename: string;
  compact?: boolean;
}

export function AuthDownloadButton({ url, filename, compact = false }: AuthDownloadButtonProps) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadAuthenticatedFile(url, filename);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={downloading}
      title={`Download ${filename}`}
      className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors whitespace-nowrap shrink-0 ${
        compact
          ? 'p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-700/70'
          : 'px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100'
      }`}
    >
      {downloading ? (
        <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        <Download className="w-3.5 h-3.5" />
      )}
      {!compact && <span>Download</span>}
    </button>
  );
}

export function FileTypeIcon({ mimeType }: { mimeType: string }) {
  return (
    <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0 text-slate-700 dark:text-slate-300">
      {mimeType.startsWith('image/') ? (
        <ImageIcon className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
      ) : (
        <FileText className="w-5 h-5 text-slate-600 dark:text-slate-300" />
      )}
    </div>
  );
}
