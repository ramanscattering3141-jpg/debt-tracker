/**
 * Save a file locally. On iPhone this opens the share sheet ("Save to Files", AirDrop…);
 * elsewhere it downloads the file. Nothing is uploaded anywhere.
 */
export async function saveFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  try {
    const file = new File([blob], filename, { type: mime });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (isTouchDevice() && nav.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return; // user closed the share sheet
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isTouchDevice() {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
}

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

/** Ask the browser not to evict IndexedDB under storage pressure. */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    /* ignore */
  }
}

/** Running from the home screen (installed) rather than a browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
