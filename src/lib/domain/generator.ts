import { diffDays } from '../utils/date';
import { isAbsentAllYear, isAbsentOn, isUnavailableInSemester } from './absence';
import { mulberry32 } from './rng';
import { CATEGORIES, CATEGORY_LABELS, emptyQuota, equitableTargets, quotaTotal } from './quotas';
import type { Category, Physician, Quota, SemesterId, Slot } from './types';
import {
	isSlotBlockedByWeekdays,
	weekdayPossibleCategories,
	weekdayPreferenceCost
} from './weekdays';

export interface GenerateOptions {
	year: number;
	physicians: Physician[];
	slots: Slot[];
	pins: Record<string, string>;
	seed: number;
	iterationsPerSemester?: number;
}

export interface GenerateResult {
	assignments: Record<string, string>;
	unassigned: string[];
	warnings: string[];
	iterations: number;
}

const RANK: Record<Category, number> = {
	weekday: 1,
	friday: 2,
	saturday: 3,
	sunday: 4,
	holidayEve: 5,
	holiday: 6
};

/** Fairness dominates spacing, which dominates weekday preferences. */
const FAIRNESS_WEIGHT = 1_000_000;
const SPACING_WEIGHT = 1_000;
const GREEDY_NOISE = 0.01;
/** Total days are the primary fairness objective; categories come second. */
const TOTAL_DAYS_WEIGHT = 4;

function slotRank(slot: Slot): number {
	return RANK[slot.type] * 10 + (slot.isWeekendBlock ? 5 : 0);
}

export function isAvailable(physician: Physician, slot: Slot): boolean {
	if (isSlotBlockedByWeekdays(physician, slot)) return false;
	return !slot.dates.some((date) => isAbsentOn(physician, date));
}

interface Move {
	kind: 'reassign' | 'swap';
	slot: Slot;
	from: string;
	to: string;
	other?: Slot;
	otherFrom?: string;
	/** Total absolute deviation from the equitable targets. */
	fairness: number;
	/** Total absolute deviation from the total-day targets. */
	days: number;
	/** Lexicographic spread score, used to break fairness ties. */
	spread: number;
	spacing: number;
	preference: number;
}

/**
 * Greedy fill followed by a seeded local search (reassignments + swaps).
 * Hard constraints: absences, unavailable weekdays, pinned slots.
 * Soft objectives, in strict order: total days, days per category, spacing,
 * weekday preferences.
 */
export function generateSchedule(options: GenerateOptions): GenerateResult {
	const { physicians, slots, pins, seed } = options;
	const iterations = options.iterationsPerSemester ?? 18_000;
	const random = mulberry32(seed || 1);
	const assignments: Record<string, string> = {};
	const warnings: string[] = [];
	const unassigned: string[] = [];

	const available = physicians
		.filter((physician) => !isAbsentAllYear(physician, options.year))
		.sort((a, b) => a.sortOrder - b.sortOrder);

	if (!available.length) {
		return {
			assignments,
			unassigned: slots.map((slot) => slot.id),
			warnings: ['Aucun médecin disponible : vérifiez les absences et les jours indisponibles.'],
			iterations: 0
		};
	}

	const bySemester: Record<SemesterId, Slot[]> = { S1: [], S2: [] };
	for (const slot of slots) bySemester[slot.semester].push(slot);

	const fairTargets = equitableTargets(physicians, options.year, slots);

	let totalIterations = 0;
	let noCandidateCount = 0;
	let singlePhysicianSemester = false;
	let previousCounts: Map<string, Quota> | undefined;

	for (const semester of ['S1', 'S2'] as SemesterId[]) {
		const semesterSlots = bySemester[semester];
		if (!semesterSlots.length) continue;

		const active = available.filter(
			(physician) => !isUnavailableInSemester(physician, options.year, semester)
		);
		if (!active.length) {
			unassigned.push(...semesterSlots.map((slot) => slot.id));
			continue;
		}
		if (active.length === 1) singlePhysicianSemester = true;

		const targets =
			semester === 'S1'
				? fairTargets.S1
				: equitableTargets(physicians, options.year, slots, previousCounts).S2;
		const physiciansById = new Map(active.map((physician) => [physician.id, physician]));
		const totalTargets = new Map<string, number>();
		for (const physician of active) {
			totalTargets.set(physician.id, quotaTotal(targets.get(physician.id) ?? emptyQuota()));
		}
		const possible = new Map<string, Set<Category>>();
		for (const physician of active) {
			possible.set(physician.id, weekdayPossibleCategories(physician, semesterSlots, semester));
		}

		const eligible = new Map<string, string[]>();
		for (const slot of semesterSlots) {
			const list = active
				.filter((physician) => isAvailable(physician, slot))
				.map((physician) => physician.id);
			eligible.set(slot.id, list);
			if (!list.length) noCandidateCount += 1;
		}

		const assignment = new Map<string, string>();
		const counts = new Map<string, Quota>();
		const dayCounts = new Map<string, number>();
		const slotDayWeights = new Map<string, number>();
		const assignedSets = new Map<string, Set<string>>();
		const assignedLists = new Map<string, Slot[]>();
		const spacingCosts = new Map<string, number>();
		const preferenceCosts = new Map<string, number>();
		for (const physician of active) {
			counts.set(physician.id, emptyQuota());
			dayCounts.set(physician.id, 0);
			assignedSets.set(physician.id, new Set<string>());
			assignedLists.set(physician.id, []);
			spacingCosts.set(physician.id, 0);
			preferenceCosts.set(physician.id, 0);
		}
		for (const slot of semesterSlots) slotDayWeights.set(slot.id, quotaTotal(slot.weights));

		const gapCost = (left: Slot | undefined, right: Slot | undefined): number => {
			if (!left || !right) return 0;
			const gap = diffDays(left.end, right.start);
			let cost = gap < 14 ? (14 - gap) ** 2 : 0;
			if (gap <= 9 && left.isWeekendBlock && right.isWeekendBlock) cost += 250;
			return cost;
		};

		const insertIndex = (list: Slot[], start: string): number => {
			let low = 0;
			let high = list.length;
			while (low < high) {
				const middle = (low + high) >>> 1;
				if (list[middle].start < start) low = middle + 1;
				else high = middle;
			}
			return low;
		};

		const addSlot = (physicianId: string, slot: Slot): void => {
			const set = assignedSets.get(physicianId);
			const count = counts.get(physicianId);
			const list = assignedLists.get(physicianId);
			if (!set || !count || !list || set.has(slot.id)) return;
			set.add(slot.id);
			for (const category of CATEGORIES) count[category] += slot.weights[category];
			dayCounts.set(
				physicianId,
				(dayCounts.get(physicianId) ?? 0) + (slotDayWeights.get(slot.id) ?? 0)
			);

			const index = insertIndex(list, slot.start);
			const previous = list[index - 1];
			const next = list[index];
			spacingCosts.set(
				physicianId,
				(spacingCosts.get(physicianId) ?? 0) -
					gapCost(previous, next) +
					gapCost(previous, slot) +
					gapCost(slot, next)
			);
			const physician = physiciansById.get(physicianId);
			if (physician) {
				preferenceCosts.set(
					physicianId,
					(preferenceCosts.get(physicianId) ?? 0) + weekdayPreferenceCost(physician, slot)
				);
			}
			list.splice(index, 0, slot);
		};

		const removeSlot = (physicianId: string, slot: Slot): void => {
			const set = assignedSets.get(physicianId);
			const count = counts.get(physicianId);
			const list = assignedLists.get(physicianId);
			if (!set || !count || !list || !set.delete(slot.id)) return;
			for (const category of CATEGORIES) count[category] -= slot.weights[category];
			dayCounts.set(
				physicianId,
				(dayCounts.get(physicianId) ?? 0) - (slotDayWeights.get(slot.id) ?? 0)
			);

			let index = insertIndex(list, slot.start);
			if (list[index]?.id !== slot.id) {
				index = list.findIndex((entry) => entry.id === slot.id);
				if (index < 0) return;
			}
			const previous = list[index - 1];
			const next = list[index + 1];
			spacingCosts.set(
				physicianId,
				(spacingCosts.get(physicianId) ?? 0) -
					gapCost(previous, slot) -
					gapCost(slot, next) +
					gapCost(previous, next)
			);
			const physician = physiciansById.get(physicianId);
			if (physician) {
				preferenceCosts.set(
					physicianId,
					(preferenceCosts.get(physicianId) ?? 0) - weekdayPreferenceCost(physician, slot)
				);
			}
			list.splice(index, 1);
		};

		const fairnessCostOf = (physicianId: string): number => {
			const count = counts.get(physicianId);
			const target = targets.get(physicianId);
			if (!count || !target) return 0;
			let cost = 0;
			for (const category of CATEGORIES) {
				const diff = count[category] - target[category];
				cost += diff * diff;
			}
			return cost;
		};

		const daysCostOf = (physicianId: string): number => {
			const diff = (dayCounts.get(physicianId) ?? 0) - (totalTargets.get(physicianId) ?? 0);
			return diff * diff;
		};

		/**
		 * Total absolute deviations. `days` is the primary fairness metric and
		 * `category` the secondary one.
		 */
		const deviationScore = (): { days: number; category: number } => {
			let days = 0;
			let categoryTotal = 0;
			for (const physician of active) {
				const count = counts.get(physician.id);
				const target = targets.get(physician.id);
				if (!count || !target) continue;
				for (const category of CATEGORIES) {
					categoryTotal += Math.abs(count[category] - target[category]);
				}
				days += Math.abs(
					(dayCounts.get(physician.id) ?? 0) - (totalTargets.get(physician.id) ?? 0)
				);
			}
			return { days, category: categoryTotal };
		};

		/**
		 * Lexicographic spread score: spreads are sorted descending and encoded
		 * in base 400, so reducing the worst category always wins over reducing
		 * a smaller one. This prevents trading a 2-day spread for another one.
		 */
		const spreadScore = (): number => {
			const spreads: number[] = [];
			for (const category of CATEGORIES) {
				let max = 0;
				let min = Number.POSITIVE_INFINITY;
				let eligibleCount = 0;
				for (const physician of active) {
					if (!possible.get(physician.id)?.has(category)) continue;
					const value = counts.get(physician.id)?.[category] ?? 0;
					if (value > max) max = value;
					if (value < min) min = value;
					eligibleCount += 1;
				}
				if (!eligibleCount) {
					spreads.push(0);
					continue;
				}
				spreads.push(max - min);
			}
			spreads.sort((left, right) => right - left);
			let score = 0;
			for (const spread of spreads) score = score * 400 + spread;
			return score;
		};

		const localCost = (physicianId: string): number => {
			const count = counts.get(physicianId);
			const target = targets.get(physicianId);
			if (!count || !target) return 0;
			return (
				(fairnessCostOf(physicianId) + daysCostOf(physicianId) * TOTAL_DAYS_WEIGHT) *
					FAIRNESS_WEIGHT +
				(spacingCosts.get(physicianId) ?? 0) * SPACING_WEIGHT +
				(preferenceCosts.get(physicianId) ?? 0)
			);
		};

		const rebuild = (source: Map<string, string>): void => {
			for (const physician of active) {
				counts.set(physician.id, emptyQuota());
				dayCounts.set(physician.id, 0);
				assignedSets.set(physician.id, new Set<string>());
				assignedLists.set(physician.id, []);
				spacingCosts.set(physician.id, 0);
				preferenceCosts.set(physician.id, 0);
			}
			assignment.clear();
			for (const slot of semesterSlots) {
				const physicianId = source.get(slot.id);
				if (!physicianId) continue;
				assignment.set(slot.id, physicianId);
				addSlot(physicianId, slot);
			}
		};

		const measureReassign = (slot: Slot, from: string, to: string): Move => {
			const beforeSpacing = (spacingCosts.get(from) ?? 0) + (spacingCosts.get(to) ?? 0);
			const beforePreference = (preferenceCosts.get(from) ?? 0) + (preferenceCosts.get(to) ?? 0);
			removeSlot(from, slot);
			addSlot(to, slot);
			assignment.set(slot.id, to);
			const afterScore = deviationScore();
			const afterSpread = spreadScore();
			const afterSpacing = (spacingCosts.get(from) ?? 0) + (spacingCosts.get(to) ?? 0);
			const afterPreference = (preferenceCosts.get(from) ?? 0) + (preferenceCosts.get(to) ?? 0);
			removeSlot(to, slot);
			addSlot(from, slot);
			assignment.set(slot.id, from);
			return {
				kind: 'reassign',
				slot,
				from,
				to,
				fairness: afterScore.category,
				days: afterScore.days,
				spread: afterSpread,
				spacing: afterSpacing - beforeSpacing,
				preference: afterPreference - beforePreference
			};
		};

		const measureSwap = (
			first: Slot,
			second: Slot,
			firstFrom: string,
			secondFrom: string
		): Move => {
			const beforeSpacing =
				(spacingCosts.get(firstFrom) ?? 0) + (spacingCosts.get(secondFrom) ?? 0);
			const beforePreference =
				(preferenceCosts.get(firstFrom) ?? 0) + (preferenceCosts.get(secondFrom) ?? 0);

			removeSlot(firstFrom, first);
			addSlot(secondFrom, first);
			assignment.set(first.id, secondFrom);
			removeSlot(secondFrom, second);
			addSlot(firstFrom, second);
			assignment.set(second.id, firstFrom);

			const afterScore = deviationScore();
			const afterSpread = spreadScore();
			const afterSpacing = (spacingCosts.get(firstFrom) ?? 0) + (spacingCosts.get(secondFrom) ?? 0);
			const afterPreference =
				(preferenceCosts.get(firstFrom) ?? 0) + (preferenceCosts.get(secondFrom) ?? 0);

			removeSlot(secondFrom, first);
			addSlot(firstFrom, first);
			assignment.set(first.id, firstFrom);
			removeSlot(firstFrom, second);
			addSlot(secondFrom, second);
			assignment.set(second.id, secondFrom);

			return {
				kind: 'swap',
				slot: first,
				from: firstFrom,
				to: secondFrom,
				other: second,
				otherFrom: secondFrom,
				fairness: afterScore.category,
				days: afterScore.days,
				spread: afterSpread,
				spacing: afterSpacing - beforeSpacing,
				preference: afterPreference - beforePreference
			};
		};

		const applyMove = (move: Move): void => {
			if (move.kind === 'reassign') {
				removeSlot(move.from, move.slot);
				addSlot(move.to, move.slot);
				assignment.set(move.slot.id, move.to);
				return;
			}
			const other = move.other;
			const otherFrom = move.otherFrom;
			if (!other || !otherFrom) return;
			removeSlot(move.from, move.slot);
			addSlot(move.to, move.slot);
			assignment.set(move.slot.id, move.to);
			removeSlot(otherFrom, other);
			addSlot(move.from, other);
			assignment.set(other.id, move.from);
		};

		const isBetter = (
			move: Move,
			best: Move | null,
			phase: 'days' | 'fairness' | 'spacing' | 'preference',
			currentFairness: number,
			currentDays: number,
			currentSpread: number
		): boolean => {
			if (phase === 'days' || phase === 'fairness') {
				if (move.days > currentDays) return false;
				if (move.days === currentDays && move.fairness > currentFairness) return false;
				if (
					move.days === currentDays &&
					move.fairness === currentFairness &&
					move.spread >= currentSpread
				) {
					return false;
				}
				if (!best) return true;
				if (move.days !== best.days) return move.days < best.days;
				if (move.fairness !== best.fairness) return move.fairness < best.fairness;
				if (move.spread !== best.spread) return move.spread < best.spread;
				if (move.spacing !== best.spacing) return move.spacing < best.spacing;
				return move.preference < best.preference;
			}
			if (
				move.days !== currentDays ||
				move.fairness !== currentFairness ||
				move.spread !== currentSpread
			) {
				return false;
			}
			if (phase === 'spacing') {
				if (move.spacing >= 0) return false;
				if (!best) return true;
				if (move.spacing !== best.spacing) return move.spacing < best.spacing;
				return move.preference < best.preference;
			}
			if (move.spacing !== 0 || move.preference >= 0) return false;
			return !best || move.preference < best.preference;
		};

		const improve = (phase: 'days' | 'fairness' | 'spacing' | 'preference'): void => {
			const nonPinned = semesterSlots.filter((slot) => !pins[slot.id]);
			const maxPasses = phase === 'preference' ? 8 : 20;
			let guard = 0;
			while (guard < maxPasses) {
				guard += 1;
				const currentScore = deviationScore();
				const currentFairness = currentScore.category;
				const currentDays = currentScore.days;
				const currentSpread = spreadScore();
				let best: Move | null = null;

				for (const slot of nonPinned) {
					const from = assignment.get(slot.id);
					if (!from) continue;
					for (const to of eligible.get(slot.id) ?? []) {
						if (to === from) continue;
						const move = measureReassign(slot, from, to);
						if (isBetter(move, best, phase, currentFairness, currentDays, currentSpread)) {
							best = move;
						}
					}
				}

				if (!best && phase === 'days') {
					const overSlots: Slot[] = [];
					const underSlots: Slot[] = [];
					for (const slot of nonPinned) {
						const physicianId = assignment.get(slot.id);
						if (!physicianId) continue;
						const difference =
							(dayCounts.get(physicianId) ?? 0) - (totalTargets.get(physicianId) ?? 0);
						if (difference > 0) overSlots.push(slot);
						if (difference < 0) underSlots.push(slot);
					}
					for (const first of overSlots) {
						const firstFrom = assignment.get(first.id);
						if (!firstFrom) continue;
						for (const second of underSlots) {
							const secondFrom = assignment.get(second.id);
							if (!secondFrom || secondFrom === firstFrom) continue;
							if (!eligible.get(first.id)?.includes(secondFrom)) continue;
							if (!eligible.get(second.id)?.includes(firstFrom)) continue;
							const move = measureSwap(first, second, firstFrom, secondFrom);
							if (isBetter(move, best, phase, currentFairness, currentDays, currentSpread)) {
								best = move;
							}
						}
					}
				}

				if (!best && phase === 'spacing') {
					const tightSlots: Slot[] = [];
					for (const slot of nonPinned) {
						const physicianId = assignment.get(slot.id);
						const list = physicianId ? assignedLists.get(physicianId) : undefined;
						if (!list) continue;
						const index = list.findIndex((entry) => entry.id === slot.id);
						if (index < 0) continue;
						const previous = list[index - 1];
						const next = list[index + 1];
						const before = previous ? diffDays(previous.end, slot.start) : Infinity;
						const after = next ? diffDays(slot.end, next.start) : Infinity;
						if (before < 3 || after < 3) tightSlots.push(slot);
					}
					for (const first of tightSlots) {
						const firstFrom = assignment.get(first.id);
						if (!firstFrom) continue;
						for (const second of nonPinned) {
							const secondFrom = assignment.get(second.id);
							if (!secondFrom || secondFrom === firstFrom) continue;
							if (!eligible.get(first.id)?.includes(secondFrom)) continue;
							if (!eligible.get(second.id)?.includes(firstFrom)) continue;
							const move = measureSwap(first, second, firstFrom, secondFrom);
							if (isBetter(move, best, phase, currentFairness, currentDays, currentSpread))
								best = move;
						}
					}
				}

				if (!best && phase === 'preference') {
					const groups = new Map<string, Slot[]>();
					for (const slot of nonPinned) {
						const key = CATEGORIES.map((category) => slot.weights[category]).join(',');
						const group = groups.get(key);
						if (group) group.push(slot);
						else groups.set(key, [slot]);
					}
					for (const group of groups.values()) {
						for (let index = 0; index < group.length; index += 1) {
							const first = group[index];
							const firstFrom = assignment.get(first.id);
							if (!firstFrom) continue;
							for (let other = index + 1; other < group.length; other += 1) {
								const second = group[other];
								const secondFrom = assignment.get(second.id);
								if (!secondFrom || secondFrom === firstFrom) continue;
								if (!eligible.get(first.id)?.includes(secondFrom)) continue;
								if (!eligible.get(second.id)?.includes(firstFrom)) continue;
								const move = measureSwap(first, second, firstFrom, secondFrom);
								if (isBetter(move, best, phase, currentFairness, currentDays, currentSpread))
									best = move;
							}
						}
					}
				}

				if (!best && phase === 'fairness') {
					const overSlots: Slot[] = [];
					const underSlots: Slot[] = [];
					for (const slot of nonPinned) {
						const physicianId = assignment.get(slot.id);
						if (!physicianId) continue;
						const count = counts.get(physicianId);
						const target = targets.get(physicianId);
						if (!count || !target) continue;
						let over = false;
						let under = false;
						for (const category of CATEGORIES) {
							if (count[category] > target[category]) over = true;
							else if (count[category] < target[category]) under = true;
						}
						if (over) overSlots.push(slot);
						if (under) underSlots.push(slot);
					}
					for (const first of overSlots) {
						const firstFrom = assignment.get(first.id);
						if (!firstFrom) continue;
						for (const second of underSlots) {
							const secondFrom = assignment.get(second.id);
							if (!secondFrom || secondFrom === firstFrom) continue;
							if (!eligible.get(first.id)?.includes(secondFrom)) continue;
							if (!eligible.get(second.id)?.includes(firstFrom)) continue;
							const move = measureSwap(first, second, firstFrom, secondFrom);
							if (isBetter(move, best, phase, currentFairness, currentDays, currentSpread))
								best = move;
						}
					}
				}

				if (!best) break;
				applyMove(best);
			}
		};

		// Pinned slots are assigned first and never moved afterwards.
		for (const slot of semesterSlots) {
			const pinned = pins[slot.id];
			if (pinned && eligible.get(slot.id)?.includes(pinned)) {
				assignment.set(slot.id, pinned);
				addSlot(pinned, slot);
			}
		}

		const order = [...semesterSlots].sort(
			(a, b) => slotRank(b) - slotRank(a) || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)
		);

		for (const slot of order) {
			if (assignment.has(slot.id)) continue;
			const candidates = eligible.get(slot.id) ?? [];
			if (!candidates.length) continue;

			let best: string | null = null;
			let bestScore = Number.NEGATIVE_INFINITY;
			for (const physicianId of candidates) {
				const before = localCost(physicianId);
				addSlot(physicianId, slot);
				const after = localCost(physicianId);
				removeSlot(physicianId, slot);
				const score = before - after + random() * GREEDY_NOISE;
				if (score > bestScore) {
					bestScore = score;
					best = physicianId;
				}
			}

			if (best) {
				assignment.set(slot.id, best);
				addSlot(best, slot);
			}
		}

		const nonPinned = semesterSlots.filter((slot) => !pins[slot.id]);
		let currentCost = 0;
		for (const physician of active) currentCost += localCost(physician.id);
		let bestAssignment = new Map(assignment);
		let bestCost = currentCost;

		for (let iteration = 0; iteration < iterations && nonPinned.length > 1; iteration += 1) {
			const temperature = 2_000_000 * Math.pow(0.0008, iteration / iterations);
			const slot = nonPinned[Math.floor(random() * nonPinned.length)];
			const currentPhysician = assignment.get(slot.id);
			if (!currentPhysician) continue;

			if (random() < 0.55) {
				const candidates = eligible.get(slot.id) ?? [];
				if (candidates.length < 2) continue;
				let other = candidates[Math.floor(random() * candidates.length)];
				if (other === currentPhysician) {
					other = candidates[(candidates.indexOf(currentPhysician) + 1) % candidates.length];
				}

				const before = localCost(currentPhysician) + localCost(other);
				removeSlot(currentPhysician, slot);
				addSlot(other, slot);
				assignment.set(slot.id, other);
				const after = localCost(currentPhysician) + localCost(other);
				const delta = after - before;

				if (delta <= 0 || random() < Math.exp(-delta / temperature)) {
					currentCost += delta;
					if (currentCost < bestCost) {
						bestCost = currentCost;
						bestAssignment = new Map(assignment);
					}
				} else {
					removeSlot(other, slot);
					addSlot(currentPhysician, slot);
					assignment.set(slot.id, currentPhysician);
				}
			} else {
				const otherSlot = nonPinned[Math.floor(random() * nonPinned.length)];
				if (!otherSlot || otherSlot.id === slot.id) continue;
				const otherPhysician = assignment.get(otherSlot.id);
				if (!otherPhysician || otherPhysician === currentPhysician) continue;
				if (!eligible.get(slot.id)?.includes(otherPhysician)) continue;
				if (!eligible.get(otherSlot.id)?.includes(currentPhysician)) continue;

				const before = localCost(currentPhysician) + localCost(otherPhysician);
				removeSlot(currentPhysician, slot);
				addSlot(otherPhysician, slot);
				assignment.set(slot.id, otherPhysician);
				removeSlot(otherPhysician, otherSlot);
				addSlot(currentPhysician, otherSlot);
				assignment.set(otherSlot.id, currentPhysician);

				const after = localCost(currentPhysician) + localCost(otherPhysician);
				const delta = after - before;

				if (delta <= 0 || random() < Math.exp(-delta / temperature)) {
					currentCost += delta;
					if (currentCost < bestCost) {
						bestCost = currentCost;
						bestAssignment = new Map(assignment);
					}
				} else {
					removeSlot(otherPhysician, slot);
					addSlot(currentPhysician, slot);
					assignment.set(slot.id, currentPhysician);
					removeSlot(currentPhysician, otherSlot);
					addSlot(otherPhysician, otherSlot);
					assignment.set(otherSlot.id, otherPhysician);
				}
			}
		}

		rebuild(bestAssignment);
		improve('days');
		improve('fairness');
		improve('spacing');
		improve('preference');

		totalIterations += iterations;

		for (const slot of semesterSlots) {
			const physicianId = assignment.get(slot.id);
			if (physicianId) assignments[slot.id] = physicianId;
			else unassigned.push(slot.id);
		}

		const gaps: string[] = [];
		let maxDaysDeviation = 0;
		for (const physician of active) {
			maxDaysDeviation = Math.max(
				maxDaysDeviation,
				Math.abs((dayCounts.get(physician.id) ?? 0) - (totalTargets.get(physician.id) ?? 0))
			);
		}
		if (maxDaysDeviation > 1) {
			gaps.push(`Jours (écart ${maxDaysDeviation})`);
		}
		for (const category of CATEGORIES) {
			let maxDeviation = 0;
			for (const physician of active) {
				if (!possible.get(physician.id)?.has(category)) continue;
				const count = counts.get(physician.id);
				const target = targets.get(physician.id);
				if (!count || !target) continue;
				maxDeviation = Math.max(maxDeviation, Math.abs(count[category] - target[category]));
			}
			if (maxDeviation > 1) {
				gaps.push(`${CATEGORY_LABELS[category]} (écart ${maxDeviation})`);
			}
		}
		if (gaps.length) {
			warnings.push(
				`Équilibre non parfait (${semester}) : ${gaps.join(', ')}. Vérifiez absences, jours indisponibles ou verrous.`
			);
		}

		if (semester === 'S1') {
			previousCounts = new Map();
			for (const physician of active) {
				const count = counts.get(physician.id);
				if (count) previousCounts.set(physician.id, { ...count });
			}
		}
	}

	if (noCandidateCount > 0) {
		warnings.push(
			`${noCandidateCount} créneau(x) n'ont aucun médecin disponible (absences ou jours indisponibles).`
		);
	}
	if (unassigned.length > 0) {
		warnings.push(
			`${unassigned.length} créneau(x) n'ont pas pu être attribués. Vérifiez les disponibilités.`
		);
	}
	if (singlePhysicianSemester) {
		warnings.push('Un seul médecin est disponible sur un semestre : aucune rotation possible.');
	}

	return { assignments, unassigned, warnings, iterations: totalIterations };
}
