// Tracks which pending staff-verification requests / flagged masks an admin has already
// seen (by visiting the relevant page) vs. already been alerted about in this browser, so
// the background AdminAlertNotifier only chimes once per genuinely new item instead of
// repeating every poll cycle for the same unvisited backlog.

export type AdminAlertCategory = "elevations" | "flagged-masks";

const SEEN_PREFIX = "visheart_admin_seen_";
const ALERTED_PREFIX = "visheart_admin_alerted_";

function readIds(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function writeIds(key: string, ids: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // Private browsing / storage disabled — nothing to persist, next poll just re-derives.
  }
}

export const adminAlertStore = {
  getSeen(category: AdminAlertCategory): Set<string> {
    return readIds(SEEN_PREFIX + category);
  },
  // Call when the admin actually visits the respective page — replaces the seen set with
  // exactly what's currently pending, so anything resolved since drops out naturally.
  markSeen(category: AdminAlertCategory, ids: string[]) {
    writeIds(SEEN_PREFIX + category, new Set(ids));
    writeIds(ALERTED_PREFIX + category, new Set());
  },
  getAlerted(category: AdminAlertCategory): Set<string> {
    return readIds(ALERTED_PREFIX + category);
  },
  markAlerted(category: AdminAlertCategory, ids: Set<string>) {
    writeIds(ALERTED_PREFIX + category, ids);
  },
};

// Short two-tone chime synthesized via the Web Audio API — no audio asset to source/ship.
export function playAdminAlertChime() {
  try {
    const AudioContextCtor =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    const now = ctx.currentTime;
    [0, 0.16].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = i === 0 ? 880 : 1175; // A5 -> D6
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(0.2, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.32);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch {
    // Autoplay policy, unsupported browser, etc. — a missed chime isn't worth surfacing.
  }
}
