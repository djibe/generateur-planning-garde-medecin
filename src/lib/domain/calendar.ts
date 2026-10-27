import { addDays, formatMedium, weekdayIndex, yearEnd, yearStart } from '../utils/date';
import { holidayMap } from './holidays';
import { emptyQuota, emptyTags } from './quotas';
import type { Category, ISODate, SemesterId, Slot, WeekendMode } from './types';

export interface Semester {
	id: SemesterId;
	start: ISODate;
	end: ISODate;
}

export function semestersOf(year: number): Semester[] {
	const juneEnd = `${year}-06-30`;
	return [
		{ id: 'S1', start: `${year}-01-01`, end: juneEnd },
		{ id: 'S2', start: addDays(juneEnd, 1), end: `${year}-12-31` }
	];
}

export function semesterOf(date: ISODate, year: number): SemesterId {
	return date <= `${year}-06-30` ? 'S1' : 'S2';
}

export function primaryType(date: ISODate, holidays: Map<string, string>): Category {
	if (holidays.has(date)) return 'holiday';
	const index = weekdayIndex(date);
	if (index === 6) return 'sunday';
	if (index === 5) return 'saturday';
	if (holidays.has(addDays(date, 1))) return 'holidayEve';
	if (index === 4) return 'friday';
	return 'weekday';
}

export function buildSlots(year: number, mode: WeekendMode): Slot[] {
	const holidays = holidayMap(year);
	const slots: Slot[] = [];
	const end = yearEnd(year);
	let cursor = yearStart(year);

	while (cursor <= end) {
		if (mode === 'combined' && weekdayIndex(cursor) === 5) {
			const sunday = addDays(cursor, 1);
			if (sunday <= end) {
				slots.push(makeSlot([cursor, sunday], holidays, year));
				cursor = addDays(sunday, 1);
				continue;
			}
		}
		slots.push(makeSlot([cursor], holidays, year));
		cursor = addDays(cursor, 1);
	}

	return slots;
}

function makeSlot(dates: ISODate[], holidays: Map<string, string>, year: number): Slot {
	const tags = emptyTags();
	const weights = emptyQuota();
	const isWeekendBlock = dates.length > 1;
	let holidayName: string | null = null;

	for (const date of dates) {
		const primary = primaryType(date, holidays);
		if (primary === 'holiday') {
			tags.holiday = true;
			holidayName ??= holidays.get(date) ?? null;
			const index = weekdayIndex(date);
			if (index === 4) tags.friday = true;
			if (index === 5) tags.saturday = true;
			if (index === 6) tags.sunday = true;
		} else if (primary === 'holidayEve') {
			tags.holidayEve = true;
		} else {
			tags[primary] = true;
		}
	}

	let type: Category;
	if (isWeekendBlock) {
		type = tags.holiday ? 'holiday' : 'saturday';
		weights.saturday = 1;
		weights.sunday = 1;
		if (tags.holiday) weights.holiday = 1;
	} else {
		type = primaryType(dates[0], holidays);
		weights[type] = 1;
	}

	const semester = semesterOf(dates[0], year);
	return {
		id: `${semester}:${dates[0]}`,
		semester,
		start: dates[0],
		end: dates[dates.length - 1],
		dates,
		type,
		weights,
		tags,
		isWeekendBlock,
		holidayName
	};
}

export function slotLabel(slot: Slot): string {
	if (slot.dates.length === 1) return formatMedium(slot.start);
	return `${formatMedium(slot.start)} – ${formatMedium(slot.end)}`;
}

export function groupBySemester(slots: Slot[]): Record<SemesterId, Slot[]> {
	const grouped: Record<SemesterId, Slot[]> = { S1: [], S2: [] };
	for (const slot of slots) grouped[slot.semester].push(slot);
	return grouped;
}

export const SLOT_TYPE_LABEL: Record<Category, string> = {
	weekday: 'Semaine',
	friday: 'Vendredi',
	saturday: 'Samedi',
	sunday: 'Dimanche',
	holidayEve: 'Veille de férié',
	holiday: 'Jour férié'
};
