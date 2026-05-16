export function parseTime(value: string): Date {
  return new Date(value);
}

export function minutesBetween(startIso: string, endIso: string): number {
  return Math.round((parseTime(endIso).getTime() - parseTime(startIso).getTime()) / 60000);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

export function formatClock(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(parseTime(value));
}

export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  if (hours === 0) {
    return `${sign}${remainder} min`;
  }

  return `${sign}${hours} hr ${remainder} min`;
}
