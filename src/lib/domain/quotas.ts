import type { Category, Physician, Quota, SemesterId, ShiftTags, Slot } from './types';

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

/** A physician is fully exempt when the flag is set without a period. */
export function isFullyExempt(physician: Physician): boolean {
	return physician.exempt && !physician.exemptFrom && !physician.exemptTo;
}

export function isActivePhysician(physician: Physician): boolean {
	return !isFullyExempt(physician);
}

export function activePhysicians(physicians: Physician[]): Physician[] {
	return physicians.filter(isActivePhysician).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function targetsByCategory(physicians: Physician[], semester: SemesterId): Quota {
	const total = emptyQuota();
	for (const physician of physicians) {
		if (isFullyExempt(physician)) continue;
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

export function averageTargets(
	physicians: Physician[],
	semester: SemesterId,
	capacity: Quota
): void {
	const active = activePhysicians(physicians);
	for (const physician of physicians) {
		if (isFullyExempt(physician)) {
			physician.targets[semester] = emptyQuota();
		}
	}
	for (const category of CATEGORIES) {
		const split = evenSplit(capacity[category], active.length);
		active.forEach((physician, index) => {
			physician.targets[semester][category] = split[index] ?? 0;
		});
	}
}

export function adjustTargets(
	physicians: Physician[],
	semester: SemesterId,
	capacity: Quota
): void {
	const active = activePhysicians(physicians);
	if (!active.length) return;
	for (const category of CATEGORIES) {
		const current = active.map((physician) => physician.targets[semester][category] ?? 0);
		const next = normalizeToTotal(current, capacity[category]);
		active.forEach((physician, index) => {
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

export function quotaMismatches(physicians: Physician[], slots: Slot[]): QuotaMismatch[] {
	const mismatches: QuotaMismatch[] = [];
	const active = activePhysicians(physicians);
	if (!active.length) return mismatches;
	for (const semester of ['S1', 'S2'] as SemesterId[]) {
		const capacity = capacityByCategory(slots, semester);
		const targets = targetsByCategory(physicians, semester);
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
