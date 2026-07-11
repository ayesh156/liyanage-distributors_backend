/**
 * Sri Lanka (Asia/Colombo) Timestamp Utilities
 *
 * liyanage-distributors operates in Sri Lanka timezone (UTC+5:30).
 * Prisma serializes Date → UTC ISO string before sending to MySQL.
 * By pre-shifting the epoch forward by +5.5 hours, the UTC ISO string
 * will contain the Colombo wall-clock time.
 *
 * Usage:
 *   colomboNow()        → Date shifted to Colombo time
 *   colomboMySQLDateTime() → "2026-07-09 21:45:00" string for MySQL
 */

export function colomboNow(): Date {
  const now = new Date();
  return new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
}

export function colomboISOString(): string {
  return colomboNow().toISOString();
}

export function colomboMySQLDateTime(): string {
  const now = new Date();
  const fmtDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const fmtTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now);

  return `${fmtDate} ${fmtTime}`;
}

export function colomboDate(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' }));
}