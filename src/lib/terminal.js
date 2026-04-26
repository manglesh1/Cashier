// Per-tablet terminal pairing — survives sign-in / sign-out.
// Cleared only by an explicit "Switch terminal" action (manager UX).

const KEY = "cashier:terminal";

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
