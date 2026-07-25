const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateForDisplay(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : { date: value, dateOnly: false };
  }

  const text = String(value ?? "").trim();
  if (!text) return null;

  const dateOnlyMatch = DATE_ONLY_PATTERN.exec(text);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }

    return { date, dateOnly: true };
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : { date, dateOnly: false };
}

/**
 * Formats database calendar dates without shifting them across a day boundary.
 * Real timestamps retain normal Intl timezone behavior.
 */
export function formatDisplayDate(
  value,
  { locale, fallback = "", ...formatOptions } = {}
) {
  const parsed = parseDateForDisplay(value);
  if (!parsed) return fallback;

  const options = parsed.dateOnly
    ? { ...formatOptions, timeZone: "UTC" }
    : formatOptions;

  return new Intl.DateTimeFormat(locale, options).format(parsed.date);
}

export const _internal = {
  parseDateForDisplay,
};
