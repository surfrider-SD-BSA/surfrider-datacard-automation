/**
 * Keep what the reviewer has typed, so a closed tab does not cost an afternoon.
 *
 * Typing up a 58-card event is 450 numbers read off 450 pictures. Until this
 * existed all of them lived in one in-memory Map: a reload, a stray Cmd-W, or
 * the tab running out of memory took the lot, with nothing to recover from.
 * That is a bad failure on any tool and a worse one here, because the person
 * doing the typing is a volunteer doing it for free.
 *
 * Three things this deliberately does NOT do:
 *
 *   It does not restore anything on its own. A draft is offered, with its age
 *   and how many values it holds, and the reviewer says yes. Silently putting
 *   numbers into boxes is the one outcome this tool must not produce -- the
 *   browser's own form restore was turned off for exactly that reason (see the
 *   note on the input in main.ts), and this must not reintroduce it by the back
 *   door.
 *
 *   It does not offer a draft for a different file. The values are keyed by
 *   card number and taxonomy row, which are stable for a given PDF and
 *   meaningless across two, so the draft records a fingerprint of the file and
 *   of what came out of it, and is only offered on an exact match.
 *
 *   It does not leave the machine. This is localStorage: same origin, same
 *   browser, no network. The whole point of the tool is that the scan stays on
 *   the laptop, and a draft of what someone read off it is the same data.
 */

const KEY = "surfrider-datacard:draft:v1";

export interface DraftFingerprint {
  fileName: string;
  fileSize: number;
  cardCount: number;
  cellCount: number;
}

export interface Draft extends DraftFingerprint {
  savedAt: number;
  event: Record<string, string>;
  /** cardNumber -> [taxonomy row, value][] */
  values: [number, [number, number][]][];
}

export interface DraftStore {
  /** False when the browser refuses to store anything -- private mode, quota. */
  readonly available: boolean;
  save(draft: Draft): void;
  load(): Draft | null;
  clear(): void;
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Storage disabled by policy: touching the property itself can throw.
    return null;
  }
}

/**
 * Can this store actually keep anything?
 *
 * Answered by writing, because that is the only honest test: Safari in private
 * mode exposes the whole localStorage API and throws on `setItem`. Reading a
 * `null` back, or trusting that the object exists, would tell a reviewer their
 * work was safe while it was being dropped.
 */
function canWrite(storage: Storage | null): boolean {
  if (!storage) return false;
  const probe = `${KEY}:probe`;
  try {
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function createDraftStore(storage: Storage | null = browserStorage()): DraftStore {
  return {
    available: canWrite(storage),

    save(draft) {
      if (!storage) return;
      try {
        storage.setItem(KEY, JSON.stringify(draft));
      } catch {
        // Out of quota, or storage revoked mid-session. Losing the draft is
        // bad; taking the page down with it while someone is typing is worse.
      }
    },

    load() {
      if (!storage) return null;
      try {
        const raw = storage.getItem(KEY);
        if (!raw) return null;
        const draft = JSON.parse(raw) as Draft;
        // Anything shaped wrong is from an older version or a corrupted write.
        if (!Array.isArray(draft?.values) || typeof draft.fileName !== "string") return null;
        return draft;
      } catch {
        return null;
      }
    },

    clear() {
      if (!storage) return;
      try {
        storage.removeItem(KEY);
      } catch {
        /* nothing useful to do */
      }
    },
  };
}

/** Is this draft for the file and the extraction now on screen? */
export function draftMatches(draft: Draft, now: DraftFingerprint): boolean {
  return (
    draft.fileName === now.fileName &&
    draft.fileSize === now.fileSize &&
    draft.cardCount === now.cardCount &&
    draft.cellCount === now.cellCount
  );
}

export function countValues(draft: Draft): number {
  return draft.values.reduce((n, [, rows]) => n + rows.length, 0);
}

/** "3 minutes ago", for a line the reviewer has to make a decision from. */
export function describeAge(savedAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
