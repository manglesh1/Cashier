export function getParkClock(timezone, instant = new Date()) {
  if (!String(timezone || "").trim()) throw new Error("Configure the park timezone in Control before scheduling sessions.");
  let parts;
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(instant).map((part) => [part.type, part.value]));
  } catch {
    throw new Error("Configure a valid park timezone in Control before scheduling sessions.");
  }
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function formatParkInstantTime(value, timezone) {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return "";
  getParkClock(timezone, instant);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(instant);
}
