export const MS_PER_DAY = 86_400_000;

/** Day numbers are cached per ISO date: the generator calls diffDays millions of times. */
const dayCache = new Map<string, number>();

export function pad2(value: number): string {
	return value < 10 ? `0${value}` : String(value);
}

export function fromISO(iso: string): Date {
	const [year, month, day] = iso.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day));
}

export function toISO(date: Date): string {
	return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function addDays(iso: string, days: number): string {
	const date = fromISO(iso);
	date.setUTCDate(date.getUTCDate() + days);
	return toISO(date);
}

export function dayNumber(iso: string): number {
	const cached = dayCache.get(iso);
	if (cached !== undefined) return cached;
	const value = Math.round(
		Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) /
			MS_PER_DAY
	);
	dayCache.set(iso, value);
	return value;
}

export function diffDays(from: string, to: string): number {
	return dayNumber(to) - dayNumber(from);
}

/** Monday = 0 … Sunday = 6 */
export function weekdayIndex(iso: string): number {
	return (fromISO(iso).getUTCDay() + 6) % 7;
}

export function isWeekendDay(iso: string): boolean {
	const index = weekdayIndex(iso);
	return index === 5 || index === 6;
}

export function eachDay(from: string, to: string): string[] {
	const days: string[] = [];
	let cursor = from;
	while (cursor <= to) {
		days.push(cursor);
		cursor = addDays(cursor, 1);
	}
	return days;
}

export function yearStart(year: number): string {
	return `${year}-01-01`;
}

export function yearEnd(year: number): string {
	return `${year}-12-31`;
}

export function monthStart(year: number, monthIndex: number): string {
	return `${year}-${pad2(monthIndex + 1)}-01`;
}

export function monthEnd(year: number, monthIndex: number): string {
	return toISO(new Date(Date.UTC(year, monthIndex + 1, 0)));
}

const longFormatter = new Intl.DateTimeFormat('fr-FR', {
	weekday: 'long',
	day: 'numeric',
	month: 'long',
	year: 'numeric',
	timeZone: 'UTC'
});

const mediumFormatter = new Intl.DateTimeFormat('fr-FR', {
	weekday: 'short',
	day: 'numeric',
	month: 'short',
	timeZone: 'UTC'
});

const shortFormatter = new Intl.DateTimeFormat('fr-FR', {
	day: 'numeric',
	month: 'short',
	timeZone: 'UTC'
});

const monthFormatter = new Intl.DateTimeFormat('fr-FR', {
	month: 'long',
	year: 'numeric',
	timeZone: 'UTC'
});

const monthShortFormatter = new Intl.DateTimeFormat('fr-FR', {
	month: 'short',
	timeZone: 'UTC'
});

const weekdayFormatter = new Intl.DateTimeFormat('fr-FR', {
	weekday: 'short',
	timeZone: 'UTC'
});

const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
	dateStyle: 'short',
	timeStyle: 'short'
});

export function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatLong(iso: string): string {
	return capitalize(longFormatter.format(fromISO(iso)));
}

export function formatMedium(iso: string): string {
	return capitalize(mediumFormatter.format(fromISO(iso)));
}

export function formatShort(iso: string): string {
	return shortFormatter.format(fromISO(iso));
}

export function formatMonth(year: number, monthIndex: number): string {
	return capitalize(monthFormatter.format(new Date(Date.UTC(year, monthIndex, 1))));
}

export function formatMonthShort(year: number, monthIndex: number): string {
	return capitalize(monthShortFormatter.format(new Date(Date.UTC(year, monthIndex, 1))));
}

export function formatWeekday(iso: string): string {
	return capitalize(weekdayFormatter.format(fromISO(iso)));
}

export function formatDateTime(value: string | null): string {
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '—';
	return dateTimeFormatter.format(date);
}

export function sortedUnique(values: string[]): string[] {
	return [...new Set(values)].sort();
}
