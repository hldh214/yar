const STATION_ID_RE = /^[A-Z0-9_\-]{1,32}$/;
const RADIKO_DATE_RE = /^\d{8}$/;
const RADIKO_TIMESTAMP_RE = /^\d{14}$/;

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isValidTimeParts(hour: number, minute: number, second: number): boolean {
  return (
    hour >= 0 && hour <= 23 &&
    minute >= 0 && minute <= 59 &&
    second >= 0 && second <= 59
  );
}

export function normalizeStationId(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidStationId(value: string): boolean {
  return STATION_ID_RE.test(value);
}

export function isValidRadikoDate(value: string): boolean {
  if (!RADIKO_DATE_RE.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  return isValidDateParts(year, month, day);
}

export function isValidRadikoTimestamp(value: string): boolean {
  if (!RADIKO_TIMESTAMP_RE.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  const second = Number(value.slice(12, 14));

  return isValidDateParts(year, month, day) && isValidTimeParts(hour, minute, second);
}

export function isChronologicalRange(start: string, end: string): boolean {
  return start < end;
}

export function isTimestampInRange(value: string, start: string, end: string): boolean {
  return start <= value && value < end;
}
