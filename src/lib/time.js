const EMBEDDED_CLOCK = /(^|[^\d])(\d{1,2}):(\d{2})(?::\d{2})?(?!\s*[ap]\.?m\.?)((?=$)|(?=[^\d]))/gi;

export function formatTime12Hour(value, fallback = "") {
  if (value == null || value === "") return fallback;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? fallback
      : value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  }
  const raw = String(value).trim();
  if (/^\d{1,2}:\d{2}\s*[ap]\.?m\.?$/i.test(raw)) return raw.replace(/\s*([ap])\.?m\.?$/i, " $1M").toUpperCase();
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw);
  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour <= 23 && minute <= 59) return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? fallback || raw : formatTime12Hour(date, fallback);
}

export function formatTimeRange12Hour(start, end, separator = " – ") {
  const from = formatTime12Hour(start);
  const to = formatTime12Hour(end);
  return from && to ? `${from}${separator}${to}` : from || to;
}

export function formatTimeText12Hour(value, fallback = "") {
  if (value == null || value === "") return fallback;
  return String(value).replace(EMBEDDED_CLOCK, (match, prefix, hour, minute) => `${prefix}${formatTime12Hour(`${hour}:${minute}`)}`);
}
