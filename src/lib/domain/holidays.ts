import { addDays, pad2 } from '../utils/date';
import type { ISODate } from './types';

export interface Holiday {
	date: ISODate;
	name: string;
}

/**
 * Gregorian Easter Sunday (Meeus / Jones / Butcher).
 * Returns an ISO date.
 */
export function easterSunday(year: number): ISODate {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31);
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** The 11 French metropolitan public holidays for a year. */
export function holidaysForYear(year: number): Holiday[] {
	const easter = easterSunday(year);
	const holidays: Holiday[] = [
		{ date: `${year}-01-01`, name: "Jour de l'an" },
		{ date: addDays(easter, 1), name: 'Lundi de Pâques' },
		{ date: `${year}-05-01`, name: 'Fête du Travail' },
		{ date: `${year}-05-08`, name: 'Victoire 1945' },
		{ date: addDays(easter, 39), name: 'Ascension' },
		{ date: addDays(easter, 50), name: 'Lundi de Pentecôte' },
		{ date: `${year}-07-14`, name: 'Fête nationale' },
		{ date: `${year}-08-15`, name: 'Assomption' },
		{ date: `${year}-11-01`, name: 'Toussaint' },
		{ date: `${year}-11-11`, name: 'Armistice 1918' },
		{ date: `${year}-12-25`, name: 'Noël' }
	];
	return holidays.sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * Holidays of the year + 1 January of the next year, so that 31/12 is
 * correctly detected as the eve of a public holiday.
 */
export function holidayMap(year: number): Map<ISODate, string> {
	const map = new Map<ISODate, string>();
	for (const holiday of holidaysForYear(year)) map.set(holiday.date, holiday.name);
	for (const holiday of holidaysForYear(year + 1)) {
		if (!map.has(holiday.date)) map.set(holiday.date, holiday.name);
	}
	return map;
}
