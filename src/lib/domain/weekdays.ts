import { weekdayIndex } from '../utils/date.js';
import type {
	Category,
	ISODate,
	Physician,
	SemesterId,
	Slot,
	Weekday,
	WeekdayRank
} from './types.js';

/** Monday-first order, matching `weekdayIndex` from the date helpers. */
export const WEEKDAYS: Weekday[] = ['lun', 'mar', 'mer', 'jeu', 'ven'];

export const WEEKDAY_RANKS: WeekdayRank[] = [1, 2, 3, 4, 5];

/** At least one weekday must stay available for the generator. */
export const MAX_UNAVAILABLE_WEEKDAYS = 4;

/** Unfilled preference days are neutral, equivalent to rank 3. */
export const NEUTRAL_PREFERENCE_RANK: WeekdayRank = 3;

/** Soft cost per rank step. Kept below spacing/target costs so equity stays dominant. */
export const PREFERENCE_WEIGHT = 10;

export const WEEKDAY_LABELS: Record<Weekday, string> = {
	lun: 'Lundi',
	mar: 'Mardi',
	mer: 'Mercredi',
	jeu: 'Jeudi',
	ven: 'Vendredi'
};

export const WEEKDAY_SHORT: Record<Weekday, string> = {
	lun: 'L',
	mar: 'M',
	mer: 'M',
	jeu: 'J',
	ven: 'V'
};

const WEEKDAY_BY_INDEX: Array<Weekday | null> = ['lun', 'mar', 'mer', 'jeu', 'ven', null, null];

/** Returns the weekday code for a Monday–Friday date, or null for Saturday/Sunday. */
export function weekdayCode(iso: ISODate): Weekday | null {
	return WEEKDAY_BY_INDEX[weekdayIndex(iso)] ?? null;
}

export function hasWeekdayRestriction(physician: Physician): boolean {
	return (physician.unavailableWeekdays ?? []).length > 0;
}

export function canMakeWeekdayUnavailable(physician: Physician, day: Weekday): boolean {
	const unavailable = physician.unavailableWeekdays ?? [];
	if (unavailable.includes(day)) return true;
	return unavailable.length < MAX_UNAVAILABLE_WEEKDAYS;
}

/** Preference rank for a date. Weekends and unfilled days are neutral. */
export function weekdayPreferenceRank(physician: Physician, date: ISODate): WeekdayRank {
	const code = weekdayCode(date);
	if (!code) return NEUTRAL_PREFERENCE_RANK;
	return physician.weekdayPreferences?.[code] ?? NEUTRAL_PREFERENCE_RANK;
}

/**
 * Soft cost used by the generator: lower is better.
 * Centred on the neutral rank, so doctors without preferences are unaffected.
 * Weekends and public holidays are neutral, so preferences never distort them.
 */
export function weekdayPreferenceCost(physician: Physician, slot: Slot): number {
	const rank =
		slot.dates.length === 1 && !slot.tags.holiday
			? weekdayPreferenceRank(physician, slot.start)
			: NEUTRAL_PREFERENCE_RANK;
	return (rank - NEUTRAL_PREFERENCE_RANK) * PREFERENCE_WEIGHT;
}

/** Auto-swaps ranks so a doctor always keeps a valid (possibly partial) ranking. */
export function nextWeekdayPreferences(
	current: Partial<Record<Weekday, WeekdayRank>>,
	day: Weekday,
	rank: WeekdayRank | null
): Partial<Record<Weekday, WeekdayRank>> {
	const next = { ...current };
	if (rank === null) {
		delete next[day];
		return next;
	}
	const previous = next[day];
	const clash = WEEKDAYS.find((other) => other !== day && next[other] === rank);
	if (clash) {
		if (previous === undefined) delete next[clash];
		else next[clash] = previous;
	}
	next[day] = rank;
	return next;
}

/**
 * True when the weekday rule alone prevents working this date.
 * Public holidays override the weekly pattern; holiday eves do not.
 */
export function isWeekdayBlocked(physician: Physician, date: ISODate, isHoliday = false): boolean {
	if (isHoliday) return false;
	const code = weekdayCode(date);
	if (!code) return false;
	return (physician.unavailableWeekdays ?? []).includes(code);
}

/** Weekday rule applied to a slot. Weekend blocks only contain Saturday/Sunday. */
export function isSlotBlockedByWeekdays(physician: Physician, slot: Slot): boolean {
	if (slot.dates.length === 1 && slot.tags.holiday) return false;
	return slot.dates.some((date) => isWeekdayBlocked(physician, date));
}

/** Categories that are reachable for this physician in a semester, ignoring absences. */
export function weekdayPossibleCategories(
	physician: Physician,
	slots: Slot[],
	semester: SemesterId
): Set<Category> {
	const possible = new Set<Category>();
	if (!hasWeekdayRestriction(physician)) {
		for (const slot of slots) {
			if (slot.semester !== semester) continue;
			for (const category of Object.keys(slot.weights) as Category[]) {
				if (slot.weights[category] > 0) possible.add(category);
			}
		}
		return possible;
	}
	for (const slot of slots) {
		if (slot.semester !== semester) continue;
		if (isSlotBlockedByWeekdays(physician, slot)) continue;
		for (const category of Object.keys(slot.weights) as Category[]) {
			if (slot.weights[category] > 0) possible.add(category);
		}
	}
	return possible;
}

/** Normalised, Monday-first list of the physician's unavailable weekdays. */
export function sortedWeekdays(values: readonly string[]): Weekday[] {
	return WEEKDAYS.filter((day) => values.includes(day));
}

export function formatUnavailableWeekdays(physician: Physician): string {
	return sortedWeekdays(physician.unavailableWeekdays ?? [])
		.map((day) => WEEKDAY_LABELS[day])
		.join(', ');
}

/** Rank-ordered, human-readable preference list, e.g. `Lundi (1), Mercredi (3)`. */
export function formatWeekdayPreferences(physician: Physician): string {
	const preferences = physician.weekdayPreferences ?? {};
	return WEEKDAYS.filter((day) => preferences[day] !== undefined)
		.sort((left, right) => (preferences[left] ?? 0) - (preferences[right] ?? 0))
		.map((day) => `${WEEKDAY_LABELS[day]} (${preferences[day]})`)
		.join(', ');
}

/** Monday-first CSV form, e.g. `lun=1,mer=3`. */
export function formatWeekdayPreferencesCsv(physician: Physician): string {
	const preferences = physician.weekdayPreferences ?? {};
	return WEEKDAYS.filter((day) => preferences[day] !== undefined)
		.map((day) => `${day}=${preferences[day]}`)
		.join(',');
}
