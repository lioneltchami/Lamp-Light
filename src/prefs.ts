/** Device prefs shared across Settings, Reader, and Quiz. */
export type TranslationId = "BSB" | "WEB" | "KJV";

const KEY = "lamp-light-prefs";

export type AppPrefs = {
  defaultTranslation: TranslationId;
  quizSound: boolean;
};

const defaults: AppPrefs = {
  defaultTranslation: "BSB",
  quizSound: true,
};

function readRaw(): Partial<AppPrefs> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<AppPrefs>;
  } catch {
    return {};
  }
}

export function getPrefs(): AppPrefs {
  const raw = readRaw();
  const translation = raw.defaultTranslation;
  return {
    defaultTranslation:
      translation === "BSB" || translation === "WEB" || translation === "KJV"
        ? translation
        : defaults.defaultTranslation,
    quizSound:
      typeof raw.quizSound === "boolean" ? raw.quizSound : defaults.quizSound,
  };
}

export function setPrefs(patch: Partial<AppPrefs>): AppPrefs {
  const next = { ...getPrefs(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  // Keep reader prefs translation in sync with existing Reader localStorage key.
  try {
    const reader = JSON.parse(
      localStorage.getItem("bible-reader-preferences") ?? "{}",
    ) as Record<string, unknown>;
    reader.translationId = next.defaultTranslation;
    localStorage.setItem("bible-reader-preferences", JSON.stringify(reader));
  } catch {
    /* ignore */
  }
  return next;
}

/** Soft correct / wrong tones via Web Audio — no asset files. */
export function playQuizSound(kind: "correct" | "wrong") {
  if (!getPrefs().quizSound) return;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    const now = ctx.currentTime;
    if (kind === "correct") {
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.08);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      osc.start(now);
      osc.stop(now + 0.3);
    } else {
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.setValueAtTime(180, now + 0.12);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.1, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.38);
    }
    void ctx.resume();
    setTimeout(() => void ctx.close(), 500);
  } catch {
    /* autoplay / unsupported */
  }
}
