/**
 * MoySklad returns timestamps as "yyyy-MM-dd HH:mm:ss[.SSS]" in Moscow time (UTC+3, no DST).
 * Both directions live here, with the offset as a parameter, because the docs do not say how INPUT values
 * (filter=updated>=..., changedSince) are interpreted. The probe settles it; the answer is a setting, not a code change.
 */
export const MSK_OFFSET_HOURS = 3;

export function parseMsTime(value: string, offsetHours: number = MSK_OFFSET_HOURS): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(value.trim());
  if (!m) throw new Error(`Unrecognised MoySklad timestamp: ${value}`);
  const [, y, mo, d, h, mi, s, ms] = m;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms ? Number(ms.padEnd(3, "0")) : 0);
  return new Date(utc - offsetHours * 3_600_000);
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export function formatMsTime(date: Date, offsetHours: number = MSK_OFFSET_HOURS): string {
  const shifted = new Date(date.getTime() + offsetHours * 3_600_000);
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ` +
    `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
  );
}
