import { useState } from 'react';
import { Share, PlusSquare, X } from 'lucide-react';
import { isIOS, isStandalone } from '@/lib/files';

const KEY = 'install-hint-dismissed';

/** Shown in iPhone Safari (not yet installed): how to add the app to the home screen. */
export function InstallHint() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  if (hidden || isStandalone() || !isIOS()) return null;
  return (
    <div className="relative mb-3 rounded-2xl bg-card p-4 pr-10 text-[13.5px] shadow-[0_1px_2px_rgba(60,40,110,0.06),0_2px_10px_rgba(60,40,110,0.05)]">
      <div className="font-bold text-brand">Install on your iPhone</div>
      <p className="mt-1 text-subtle leading-snug">
        Tap <Share size={15} className="inline -mt-0.5 text-brand" /> <b className="text-ink">Share</b>, then{' '}
        <PlusSquare size={15} className="inline -mt-0.5 text-brand" /> <b className="text-ink">Add to Home Screen</b>. It opens full screen, works offline and keeps your
        data on this phone.
      </p>
      <button
        aria-label="Dismiss"
        className="absolute right-3 top-3 text-subtle"
        onClick={() => {
          try {
            localStorage.setItem(KEY, '1');
          } catch {
            /* ignore */
          }
          setHidden(true);
        }}
      >
        <X size={18} />
      </button>
    </div>
  );
}
