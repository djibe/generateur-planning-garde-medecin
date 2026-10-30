import { availabilityRatio, isUnavailableInSemester } from './absence';
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

/** Makes sure a physician has a base target copy (used before absence prorating). */
function ensureTargetBase(physician: Physician): Record<SemesterId, Quota> {
	if (!physician.targetBase) {
		physician.targetBase = {
			S1: { ...(physician.targets.S1 ?? emptyQuota()) },
			S2: { ...(physician.targets.S2 ?? emptyQuota()) }
		};
	}
	return physician.targetBase;
}

export function targetsByCategory(
	physicians: Physician[],
	year: number,
	semester: SemesterId
): Quota {
	const total = emptyQuota();
	for (const physician of physicians) {
		if (isUnavailableInSemester(physician, year, semester)) continue;
		for (const category of CATEGORIES) {
			total[category] += physician.targets[semester]?.[category] ?? 0;
		}
	}
	return total;
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

/**
 * Even split of the category capacity, then prorated by the share of the
 * semester each physician is available. The base split is kept so the
 * adjustment can be replayed without compounding the absence reduction.
 */
export function averageTargets(
	physicians: Physician[],
	year: number,
	semester: SemesterId,
	capacity: Quota,
	slots: Slot[] = []
): void {
	const active = activePhysicians(physicians, year, semester);
	const possible = new Map<string, Set<Category>>();
	for (const physician of physicians) {
		possible.set(
			physician.id,
			slots.length ? weekdayPossibleCategories(physician, slots, semester) : new Set(CATEGORIES)
		);
	}
	for (const physician of physicians) {
		const base = ensureTargetBase(physician);
		if (isUnavailableInSemester(physician, year, semester)) {
			physician.targets[semester] = emptyQuota();
			base[semester] = emptyQuota();
			continue;
		}
		base[semester] = { ...(physician.targets[semester] ?? emptyQuota()) };
		for (const category of CATEGORIES) {
			if (!possible.get(physician.id)?.has(category)) {
				physician.targets[semester][category] = 0;
				base[semester][category] = 0;
			}
		}
	}
	for (const category of CATEGORIES) {
		const eligible = active.filter((physician) => possible.get(physician.id)?.has(category));
		const split = evenSplit(capacity[category], eligible.length);
		const weights = eligible.map(
			(physician, index) => split[index] * availabilityRatio(physician, year, semester)
		);
		const next = normalizeToTotal(weights, capacity[category]);
		eligible.forEach((physician, index) => {
			ensureTargetBase(physician)[semester][category] = split[index] ?? 0;
			physician.targets[semester][category] = next[index] ?? 0;
		});
	}
}

/**
 * Normalises the desired (pre-absence) targets to the available slots, while
 * reducing each physician by their own availability ratio.
 */
export function adjustTargets(
	physicians: Physician[],
	year: number,
	semester: SemesterId,
	capacity: Quota,
	slots: Slot[] = []
): void {
	const active = activePhysicians(physicians, year, semester);
	for (const physician of physicians) ensureTargetBase(physician);
	if (!active.length) return;
	const possible = new Map<string, Set<Category>>();
	for (const physician of active) {
		possible.set(
			physician.id,
			slots.length ? weekdayPossibleCategories(physician, slots, semester) : new Set(CATEGORIES)
		);
	}
	for (const category of CATEGORIES) {
		const eligible = active.filter((physician) => possible.get(physician.id)?.has(category));
		for (const physician of active) {
			if (!possible.get(physician.id)?.has(category)) {
				physician.targets[semester][category] = 0;
				ensureTargetBase(physician)[semester][category] = 0;
			}
		}
		const bases = eligible.map((physician) => ensureTargetBase(physician)[semester][category] ?? 0);
		const ratios = eligible.map((physician) => availabilityRatio(physician, year, semester));
		const weightByBase = bases.map((base, index) => base * ratios[index]);
		const weights = weightByBase.some((value) => value > 0) ? weightByBase : ratios;
		const next = normalizeToTotal(weights, capacity[category]);
		eligible.forEach((physician, index) => {
			ensureTargetBase(physician)[semester][category] = bases[index] ?? 0;
			physician.targets[semester][category] = next[index] ?? 0;
		});
	}
}

export interface QuotaMismatch {
	semester: SemesterId;
	category: Category;
	capacity: number;
	targets: number;
}

export function quotaMismatches(
	physicians: Physician[],
	year: number,
	slots: Slot[]
): QuotaMismatch[] {
	const mismatches: QuotaMismatch[] = [];
	const hasActive =
		activePhysicians(physicians, year, 'S1').length > 0 ||
		activePhysicians(physicians, year, 'S2').length > 0;
	if (!hasActive) return mismatches;
	for (const semester of ['S1', 'S2'] as SemesterId[]) {
		const capacity = capacityByCategory(slots, semester);
		const targets = targetsByCategory(physicians, year, semester);
		for (const category of CATEGORIES) {
			if (capacity[category] !== targets[category]) {
				mismatches.push({
					semester,
					category,
					capacity: capacity[category],
					targets: targets[category]
				});
			}
		}
	}
	return mismatches;
}
