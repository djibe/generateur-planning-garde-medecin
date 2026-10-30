import { addDays, diffDays, formatMedium } from '../utils/date';
import type { ISODate, Physician, SemesterId } from './types';

export interface DateRange {
	from: ISODate;
	to: ISODate;
}

/** Both dates must be set and ordered for the absence to be applied. */
export function hasAbsence(physician: Physician): boolean {
	const { absenceFrom, absenceTo } = physician;
	return !!absenceFrom && !!absenceTo && absenceFrom <= absenceTo;
}

export function isAbsentOn(physician: Physician, date: ISODate): boolean {
	if (!hasAbsence(physician)) return false;
	return date >= physician.absenceFrom! && date <= physician.absenceTo!;
}

export function semesterBounds(year: number, semester: SemesterId): DateRange {
	const juneEnd = `${year}-06-30`;
	if (semester === 'S1') return { from: `${year}-01-01`, to: juneEnd };
	return { from: addDays(juneEnd, 1), to: `${year}-12-31` };
}

export function semesterLength(year: number, semester: SemesterId): number {
	const bounds = semesterBounds(year, semester);
	return diffDays(bounds.from, bounds.to) + 1;
}

/** Number of days shared by two inclusive ranges. */
export function overlapDays(left: DateRange, right: DateRange): number {
	const from = left.from > right.from ? left.from : right.from;
	const to = left.to < right.to ? left.to : right.to;
	return from > to ? 0 : diffDays(from, to) + 1;
}

export function absenceDaysInSemester(
	physician: Physician,
	year: number,
	semester: SemesterId
): number {
	if (!hasAbsence(physician)) return 0;
	return overlapDays(
		{ from: physician.absenceFrom!, to: physician.absenceTo! },
		semesterBounds(year, semester)
	);
}

export function absenceDaysInYear(physician: Physician, year: number): number {
	return (
		absenceDaysInSemester(physician, year, 'S1') + absenceDaysInSemester(physician, year, 'S2')
	);
}

/** Share of the semester during which the physician is available, from 0 to 1. */
export function availabilityRatio(
	physician: Physician,
	year: number,
	semester: SemesterId
): number {
	const length = semesterLength(year, semester);
	if (length <= 0) return 1;
	const absent = absenceDaysInSemester(physician, year, semester);
	return Math.max(0, Math.min(1, (length - absent) / length));
}

export function isUnavailableInSemester(
	physician: Physician,
	year: number,
	semester: SemesterId
): boolean {
	return availabilityRatio(physician, year, semester) <= 0;
}

export function isAbsentAllYear(physician: Physician, year: number): boolean {
	return (
		isUnavailableInSemester(physician, year, 'S1') && isUnavailableInSemester(physician, year, 'S2')
	);
}

export function formatAbsence(physician: Physician): string {
	if (!hasAbsence(physician)) return '—';
	return `${formatMedium(physician.absenceFrom!)} → ${formatMedium(physician.absenceTo!)}`;
}
