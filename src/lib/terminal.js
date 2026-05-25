// Per-tablet terminal pairing — survives sign-in / sign-out.
// Cleared only by an explicit "Switch terminal" action (manager UX).

const KEY = "cashier:terminal";

// Fired after the cached terminal settings change so live consumers
// (useEffectiveSettings) re-read without a full page reload / re-pair.
export const SETTINGS_UPDATED_EVENT = "cashier:settings-updated";

export const getTerminal = () => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const setTerminal = (terminal) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(terminal));
  } catch { /* noop */ }
};

export const clearTerminal = () => {
  try {
    localStorage.removeItem(KEY);
  } catch { /* noop */ }
};

// Refresh just the cached settings on the paired terminal (e.g. from a
// heartbeat response) so admin edits propagate without a full re-pair.
// Returns true when the stored settings actually changed.
export const updateTerminalSettings = (settings) => {
  if (!settings || typeof settings !== "object") return false;
  const terminal = getTerminal();
  if (!terminal) return false;
  const prev = JSON.stringify(terminal.settings || {});
  const next = JSON.stringify(settings);
  if (prev === next) return false;
  setTerminal({ ...terminal, settings });
  try {
    window.dispatchEvent(new Event(SETTINGS_UPDATED_EVENT));
  } catch { /* noop */ }
  return true;
};
