import { availabilityRatioYear, isUnavailableInSemester } from './absence';
import type { Category, Physician, Quota, SemesterId, ShiftTags, Slot } from './types';
import { weekdayPossibleCategories } from './weekdays';

export const CATEGORIES: Category[] = [
	'weekday',
	'friday',
	'saturday',
	'sunday',
	'holidayEve',
	'holiday'
];

export const CATEGORY_LABELS: Record<Category, string> = {
	weekday: 'Semaine',
	friday: 'Vendredi',
	saturday: 'Samedi',
	sunday: 'Dimanche',
	holidayEve: 'Veille de férié',
	holiday: 'Jour férié'
};

export const CATEGORY_SHORT: Record<Category, string> = {
	weekday: 'Sem.',
	friday: 'Ven.',
	saturday: 'Sam.',
	sunday: 'Dim.',
	holidayEve: 'V. férié',
	holiday: 'Férié'
};

export const CATEGORY_ICON: Record<Category, string> = {
	weekday: 'bi-calendar-week',
	friday: 'bi-calendar-event',
	saturday: 'bi-calendar-weekend',
	sunday: 'bi-sun',
	holidayEve: 'bi-moon-stars',
	holiday: 'bi-star'
};

export function emptyQuota(): Quota {
	return { weekday: 0, friday: 0, saturday: 0, sunday: 0, holidayEve: 0, holiday: 0 };
}

export function emptyTags(): ShiftTags {
	return {
		weekday: false,
		friday: false,
		saturday: false,
		sunday: false,
		holidayEve: false,
		holiday: false
	};
}

export function quotaTotal(quota: Quota): number {
	return CATEGORIES.reduce((total, category) => total + quota[category], 0);
}

export function sumQuotas(...quotas: Quota[]): Quota {
	const result = emptyQuota();
	for (const quota of quotas) {
		for (const category of CATEGORIES) result[category] += quota[category];
	}
	return result;
}

export function capacityByCategory(slots: Slot[], semester?: SemesterId): Quota {
	const capacity = emptyQuota();
	for (const slot of slots) {
		if (semester && slot.semester !== semester) continue;
		for (const category of CATEGORIES) capacity[category] += slot.weights[category];
	}
	return capacity;
}

/** Physicians who still have some availability in the semester. */
export function activePhysicians(
	physicians: Physician[],
	year: number,
	semester: SemesterId
): Physician[] {
	return physicians
		.filter((physician) => !isUnavailableInSemester(physician, year, semester))
		.sort((a, b) => a.sortOrder - b.sortOrder);
}

export function evenSplit(total: number, count: number): number[] {
	if (count <= 0) return [];
	const base = Math.floor(total / count);
	const remainder = total - base * count;
	return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

/** Largest-remainder normalisation of a set of numbers to a given total. */
export function normalizeToTotal(values: number[], total: number): number[] {
	if (!values.length) return [];
	const sum = values.reduce((acc, value) => acc + value, 0);
	if (sum <= 0) return evenSplit(total, values.length);
	const scaled = values.map((value) => (value * total) / sum);
	const floors = scaled.map((value) => Math.floor(value));
	let remaining = total - floors.reduce((acc, value) => acc + value, 0);
	const order = scaled
		.map((value, index) => ({ index, fraction: value - floors[index] }))
		.sort((a, b) => b.fraction - a.fraction);
	const result = [...floors];
	let cursor = 0;
	while (remaining > 0) {
		result[order[cursor % order.length].index] += 1;
		remaining -= 1;
		cursor += 1;
	}
	return result;
}

export interface EquitableTargets {
	/** Full-year target per physician, before splitting into semesters. */
	year: Map<string, Quota>;
	S1: Map<string, Quota>;
	S2: Map<string, Quota>;
}

export function emptyEquitableTargets(): EquitableTargets {
	return { year: new Map(), S1: new Map(), S2: new Map() };
}

/**
 * Computes the reference distribution used by the generator and the reports.
 * Each category is split as evenly as possible among eligible physicians,
 * proportionally to their availability. The year target is computed first, then
 * S1 is taken from it and S2 receives the remainder, so the extra day of a
 * rounding remainder is not always given to the same physicians.
 */
export function equitableTargets(
	physicians: Physician[],
	year: number,
	slots: Slot[],
	previousCounts?: Map<string, Quota>
): EquitableTargets {
	const yearCapacity = capacityByCategory(slots);
	const s1Capacity = capacityByCategory(slots, 'S1');
	const s2Capacity = capacityByCategory(slots, 'S2');

	const yearTargets = new Map<string, Quota>();
	const s1Targets = new Map<string, Quota>();
	const s2Targets = new Map<string, Quota>();
	const possibleYear = new Map<string, Set<Category>>();
	const possibleS1 = new Map<string, Set<Category>>();
	const possibleS2 = new Map<string, Set<Category>>();

	for (const physician of physicians) {
		yearTargets.set(physician.id, emptyQuota());
		s1Targets.set(physician.id, emptyQuota());
		s2Targets.set(physician.id, emptyQuota());
		const first = weekdayPossibleCategories(physician, slots, 'S1');
		const second = weekdayPossibleCategories(physician, slots, 'S2');
		possibleS1.set(physician.id, first);
		possibleS2.set(physician.id, second);
		possibleYear.set(physician.id, new Set([...first, ...second]));
	}

	const yearActive = physicians.filter(
		(physician) =>
			!isUnavailableInSemester(physician, year, 'S1') ||
			!isUnavailableInSemester(physician, year, 'S2')
	);
	const firstSemester = activePhysicians(physicians, year, 'S1');
	const secondSemester = activePhysicians(physicians, year, 'S2');

	for (const category of CATEGORIES) {
		const yearEligible = yearActive.filter((physician) =>
			possibleYear.get(physician.id)?.has(category)
		);
		if (!yearEligible.length || yearCapacity[category] <= 0) continue;

		const yearWeights = yearEligible.map((physician) => availabilityRatioYear(physician, year));
		const yearSplit = normalizeToTotal(yearWeights, yearCapacity[category]);
		yearEligible.forEach((physician, index) => {
			yearTargets.get(physician.id)![category] = yearSplit[index] ?? 0;
		});

		const s1Eligible = firstSemester.filter((physician) =>
			possibleS1.get(physician.id)?.has(category)
		);
		if (s1Eligible.length && s1Capacity[category] > 0) {
			const desired = s1Eligible.map((physician) => yearTargets.get(physician.id)![category]);
			const split = normalizeToTotal(desired, s1Capacity[category]);
			s1Eligible.forEach((physician, index) => {
				s1Targets.get(physician.id)![category] = split[index] ?? 0;
			});
		}

		const s2Eligible = secondSemester.filter((physician) =>
			possibleS2.get(physician.id)?.has(category)
		);
		if (s2Eligible.length && s2Capacity[category] > 0) {
			const desired = s2Eligible.map((physician) => {
				const already = previousCounts
					? (previousCounts.get(physician.id)?.[category] ?? 0)
					: s1Targets.get(physician.id)![category];
				return Math.max(0, yearTargets.get(physician.id)![category] - already);
			});
			const split = normalizeToTotal(desired, s2Capacity[category]);
			s2Eligible.forEach((physician, index) => {
				s2Targets.get(physician.id)![category] = split[index] ?? 0;
			});
		}
	}

	return { year: yearTargets, S1: s1Targets, S2: s2Targets };
}
