import { availabilityRatioYear, isAbsentOn, isUnavailableInSemester } from './absence';
import type { Category, Physician, Quota, SemesterId, ShiftTags, Slot } from './types';
import { isSlotBlockedByWeekdays, weekdayPossibleCategories } from './weekdays';

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

/**
 * Largest-remainder normalisation of a set of numbers to a given total.
 *
 * When `currentTotals` is provided, the rounding remainders are given to the
 * physicians with the lowest accumulated total first. This prevents the same
 * physicians from receiving the extra day in every category, which is what
 * used to create a multi-day gap between the annual targets.
 */
export function normalizeToTotal(
	values: number[],
	total: number,
	currentTotals?: number[]
): number[] {
	if (!values.length) return [];
	const sum = values.reduce((acc, value) => acc + value, 0);
	if (sum <= 0) {
		if (!currentTotals?.length) return evenSplit(total, values.length);
		const base = Math.floor(total / values.length);
		const result = values.map(() => base);
		const order = values
			.map((_, index) => ({ index, current: currentTotals[index] ?? 0 }))
			.sort((a, b) => a.current - b.current || a.index - b.index);
		let remaining = total - base * values.length;
		let cursor = 0;
		while (remaining > 0) {
			result[order[cursor % order.length].index] += 1;
			remaining -= 1;
			cursor += 1;
		}
		return result;
	}
	const scaled = values.map((value) => (value * total) / sum);
	const floors = scaled.map((value) => Math.floor(value));
	let remaining = total - floors.reduce((acc, value) => acc + value, 0);
	const order = scaled
		.map((value, index) => ({
			index,
			fraction: value - floors[index],
			priority: (currentTotals?.[index] ?? 0) + floors[index]
		}))
		.sort((a, b) => {
			if (currentTotals?.length && a.priority !== b.priority) {
				return a.priority - b.priority;
			}
			if (a.fraction !== b.fraction) return b.fraction - a.fraction;
			return a.index - b.index;
		});
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

/** Number of days a physician can actually work in the period. */
function eligibleDayCapacity(physician: Physician, slots: Slot[], semester?: SemesterId): number {
	let capacity = 0;
	for (const slot of slots) {
		if (semester && slot.semester !== semester) continue;
		if (isSlotBlockedByWeekdays(physician, slot)) continue;
		if (slot.dates.some((date) => isAbsentOn(physician, date))) continue;
		capacity += quotaTotal(slot.weights);
	}
	return capacity;
}

/**
 * Splits a total number of days among physicians, respecting the number of
 * days each one can actually work. Any excess is redistributed to the others.
 */
function desiredDayTotals(
	physicians: Physician[],
	weights: number[],
	total: number,
	capacities: Map<string, number>
): Map<string, number> {
	const desired = new Map<string, number>();
	let remaining = physicians.map((physician, index) => ({
		physician,
		weight: weights[index] ?? 0
	}));
	let remainingTotal = total;

	while (remaining.length && remainingTotal > 0) {
		const split = normalizeToTotal(
			remaining.map((entry) => entry.weight),
			remainingTotal
		);
		const next: typeof remaining = [];
		let capped = false;
		remaining.forEach((entry, index) => {
			const capacity = capacities.get(entry.physician.id) ?? 0;
			const value = split[index] ?? 0;
			if (value > capacity) {
				desired.set(entry.physician.id, capacity);
				remainingTotal -= capacity;
				capped = true;
			} else {
				next.push(entry);
			}
		});
		if (!capped) {
			remaining.forEach((entry, index) => {
				desired.set(entry.physician.id, split[index] ?? 0);
			});
			break;
		}
		remaining = next;
	}

	for (const physician of physicians) {
		if (!desired.has(physician.id)) desired.set(physician.id, 0);
	}
	return desired;
}

/** Large categories first: they are the easiest to use for compensation. */
const COMPENSATION_ORDER: Category[] = [
	'weekday',
	'saturday',
	'sunday',
	'friday',
	'holidayEve',
	'holiday'
];

/**
 * Moves target days between physicians until each one reaches the requested
 * total. Transfers happen inside a category both physicians can work, so the
 * per-category capacities are unchanged. A two-step chain is used when no
 * direct shared category exists.
 */
function compensateTotals(
	targets: Map<string, Quota>,
	desired: Map<string, number>,
	eligible: Map<string, Set<Category>>,
	linkedWeekends: boolean
): void {
	const ids = [...targets.keys()];
	const totals = new Map<string, number>();
	for (const id of ids) {
		const target = targets.get(id);
		totals.set(id, target ? quotaTotal(target) : 0);
	}
	let guard = 10_000;

	while (guard > 0) {
		guard -= 1;
		let under: string | null = null;
		let underDeficit = 0;
		let over: string | null = null;
		let overSurplus = 0;

		for (const id of ids) {
			const difference = (desired.get(id) ?? 0) - (totals.get(id) ?? 0);
			if (difference > underDeficit) {
				underDeficit = difference;
				under = id;
			}
			if (-difference > overSurplus) {
				overSurplus = -difference;
				over = id;
			}
		}

		if (!under || !over) break;
		const underTarget = targets.get(under);
		const overTarget = targets.get(over);
		if (!underTarget || !overTarget) break;
		const underEligible = eligible.get(under) ?? new Set<Category>();
		const categories = linkedWeekends
			? COMPENSATION_ORDER.filter((category) => category !== 'saturday' && category !== 'sunday')
			: COMPENSATION_ORDER;

		let transferred = false;
		for (const category of categories) {
			if (!underEligible.has(category) || overTarget[category] <= 0) continue;
			overTarget[category] -= 1;
			underTarget[category] += 1;
			totals.set(over, (totals.get(over) ?? 1) - 1);
			totals.set(under, (totals.get(under) ?? 0) + 1);
			transferred = true;
			break;
		}
		if (transferred) continue;

		// Weekend pairs must move together so the targets stay feasible.
		if (
			linkedWeekends &&
			underDeficit >= 2 &&
			underEligible.has('saturday') &&
			underEligible.has('sunday') &&
			overTarget.saturday > 0 &&
			overTarget.sunday > 0
		) {
			overTarget.saturday -= 1;
			overTarget.sunday -= 1;
			underTarget.saturday += 1;
			underTarget.sunday += 1;
			totals.set(over, (totals.get(over) ?? 2) - 2);
			totals.set(under, (totals.get(under) ?? 0) + 2);
			continue;
		}

		// Chain: over -> middle in one category, middle -> under in another.
		for (const middle of ids) {
			if (middle === under || middle === over) continue;
			const middleTarget = targets.get(middle);
			const middleEligible = eligible.get(middle);
			if (!middleTarget || !middleEligible) continue;
			for (const fromCategory of categories) {
				if (!middleEligible.has(fromCategory) || overTarget[fromCategory] <= 0) continue;
				for (const toCategory of categories) {
					if (fromCategory === toCategory) continue;
					if (!underEligible.has(toCategory) || !middleEligible.has(toCategory)) continue;
					if (middleTarget[toCategory] <= 0) continue;
					overTarget[fromCategory] -= 1;
					middleTarget[fromCategory] += 1;
					middleTarget[toCategory] -= 1;
					underTarget[toCategory] += 1;
					totals.set(over, (totals.get(over) ?? 1) - 1);
					totals.set(under, (totals.get(under) ?? 0) + 1);
					transferred = true;
					break;
				}
				if (transferred) break;
			}
			if (transferred) break;
		}
		if (!transferred) break;
	}
}

/**
 * In combined-weekend mode a single slot consumes one Saturday and one Sunday.
 * The independent category splits can therefore ask for 3 Saturdays and 2
 * Sundays, which no schedule can satisfy. This pass allocates whole weekend
 * blocks, derives Saturday/Sunday targets from them, then removes one weekend
 * day where a holiday weekend replaces it. The targets stay feasible.
 */
function linkWeekendTargets(
	targets: Map<string, Quota>,
	capacity: Quota,
	weekendBlocks: number
): void {
	if (weekendBlocks <= 0) return;
	const rows = [...targets.entries()].map(([id, target], index) => ({
		id,
		index,
		target,
		weekendTotal: target.saturday + target.sunday
	}));
	const blocks = normalizeToTotal(
		rows.map((row) => row.weekendTotal),
		weekendBlocks
	);
	rows.forEach((row, index) => {
		const count = blocks[index] ?? 0;
		row.target.saturday = count;
		row.target.sunday = count;
	});

	// A holiday weekend replaces one Saturday or one Sunday by a holiday day.
	const remove = (category: 'saturday' | 'sunday', amount: number): void => {
		if (amount <= 0) return;
		const order = [...rows].sort(
			(a, b) =>
				b.target.holiday - a.target.holiday ||
				b.target[category] - a.target[category] ||
				a.index - b.index
		);
		let remaining = amount;
		for (const row of order) {
			while (remaining > 0 && row.target[category] > 0) {
				row.target[category] -= 1;
				remaining -= 1;
			}
			if (remaining <= 0) break;
		}
	};
	const totalBlocks = rows.reduce((sum, row) => sum + row.target.saturday, 0);
	remove('saturday', totalBlocks - capacity.saturday);
	remove('sunday', totalBlocks - capacity.sunday);
}

/**
 * Builds per-category targets, then compensates the row totals so every
 * physician reaches the same number of days (prorated for absences). A
 * physician who can never work a category (e.g. no Fridays) receives more
 * days in the categories they can work instead.
 */
function buildCategoryTargets(
	capacity: Quota,
	active: Physician[],
	possible: Map<string, Set<Category>>,
	desiredTotals: Map<string, number>,
	seedTargets?: Map<string, Quota>,
	subtractTargets?: Map<string, Quota>,
	linkedWeekends = false,
	weekendBlocks = 0
): Map<string, Quota> {
	const targets = new Map<string, Quota>();
	const running = new Map<string, number>();
	for (const physician of active) {
		targets.set(physician.id, emptyQuota());
		running.set(physician.id, 0);
	}

	for (const category of CATEGORIES) {
		const eligible = active.filter((physician) => possible.get(physician.id)?.has(category));
		if (!eligible.length || capacity[category] <= 0) continue;
		const desired = eligible.map((physician) => {
			if (seedTargets) {
				const already = subtractTargets?.get(physician.id)?.[category] ?? 0;
				return Math.max(0, (seedTargets.get(physician.id)?.[category] ?? 0) - already);
			}
			return Math.max(0, (desiredTotals.get(physician.id) ?? 0) - (running.get(physician.id) ?? 0));
		});
		const split = normalizeToTotal(
			desired,
			capacity[category],
			eligible.map((physician) => running.get(physician.id) ?? 0)
		);
		eligible.forEach((physician, index) => {
			const target = targets.get(physician.id);
			const value = split[index] ?? 0;
			if (!target) return;
			target[category] = value;
			running.set(physician.id, (running.get(physician.id) ?? 0) + value);
		});
	}

	if (linkedWeekends) linkWeekendTargets(targets, capacity, weekendBlocks);
	compensateTotals(targets, desiredTotals, possible, linkedWeekends);
	return targets;
}

/**
 * Computes the reference distribution used by the generator and the reports.
 * The total number of days is allocated first (prorated by absences), then each
 * category is split among eligible physicians and compensated so that every
 * physician reaches their total-day target.
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

	const possibleYear = new Map<string, Set<Category>>();
	const possibleS1 = new Map<string, Set<Category>>();
	const possibleS2 = new Map<string, Set<Category>>();

	for (const physician of physicians) {
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

	const linkedWeekends = slots.some((slot) => slot.isWeekendBlock);
	const countWeekendBlocks = (semester?: SemesterId): number =>
		slots.filter((slot) => slot.isWeekendBlock && (!semester || slot.semester === semester)).length;
	const yearWeekendBlocks = countWeekendBlocks();
	const s1WeekendBlocks = countWeekendBlocks('S1');
	const s2WeekendBlocks = countWeekendBlocks('S2');
	const yearCapacityTotal = quotaTotal(yearCapacity);
	const s1CapacityTotal = quotaTotal(s1Capacity);
	const s2CapacityTotal = quotaTotal(s2Capacity);

	const yearCapacities = new Map<string, number>();
	const s1Capacities = new Map<string, number>();
	const s2Capacities = new Map<string, number>();
	for (const physician of physicians) {
		yearCapacities.set(physician.id, eligibleDayCapacity(physician, slots));
		s1Capacities.set(physician.id, eligibleDayCapacity(physician, slots, 'S1'));
		s2Capacities.set(physician.id, eligibleDayCapacity(physician, slots, 'S2'));
	}

	const yearDesired = desiredDayTotals(
		yearActive,
		yearActive.map((physician) => availabilityRatioYear(physician, year)),
		yearCapacityTotal,
		yearCapacities
	);
	for (const physician of physicians) {
		if (!yearDesired.has(physician.id)) yearDesired.set(physician.id, 0);
	}

	const yearTargets = buildCategoryTargets(
		yearCapacity,
		yearActive,
		possibleYear,
		yearDesired,
		undefined,
		undefined,
		linkedWeekends,
		yearWeekendBlocks
	);

	const s1Desired = desiredDayTotals(
		firstSemester,
		firstSemester.map((physician) => yearDesired.get(physician.id) ?? 0),
		s1CapacityTotal,
		s1Capacities
	);
	for (const physician of physicians) {
		if (!s1Desired.has(physician.id)) s1Desired.set(physician.id, 0);
	}

	const s1Targets = buildCategoryTargets(
		s1Capacity,
		firstSemester,
		possibleS1,
		s1Desired,
		yearTargets,
		undefined,
		linkedWeekends,
		s1WeekendBlocks
	);

	const s2Weights = secondSemester.map((physician) => {
		const already = previousCounts
			? quotaTotal(previousCounts.get(physician.id) ?? emptyQuota())
			: quotaTotal(s1Targets.get(physician.id) ?? emptyQuota());
		return Math.max(0, (yearDesired.get(physician.id) ?? 0) - already);
	});
	const s2Desired = desiredDayTotals(secondSemester, s2Weights, s2CapacityTotal, s2Capacities);
	for (const physician of physicians) {
		if (!s2Desired.has(physician.id)) s2Desired.set(physician.id, 0);
	}

	const s2Targets = buildCategoryTargets(
		s2Capacity,
		secondSemester,
		possibleS2,
		s2Desired,
		yearTargets,
		previousCounts ?? s1Targets,
		linkedWeekends,
		s2WeekendBlocks
	);

	for (const physician of physicians) {
		if (!yearTargets.has(physician.id)) yearTargets.set(physician.id, emptyQuota());
		if (!s1Targets.has(physician.id)) s1Targets.set(physician.id, emptyQuota());
		if (!s2Targets.has(physician.id)) s2Targets.set(physician.id, emptyQuota());
	}

	return { year: yearTargets, S1: s1Targets, S2: s2Targets };
}
