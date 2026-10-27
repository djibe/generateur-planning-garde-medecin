import { diffDays } from '../utils/date';
import { mulberry32 } from './rng';
import { CATEGORIES, capacityByCategory, emptyQuota, evenSplit, isFullyExempt } from './quotas';
import type { Category, Physician, Quota, SemesterId, Slot } from './types';

export interface GenerateOptions {
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

function slotRank(slot: Slot): number {
	return RANK[slot.type] * 10 + (slot.isWeekendBlock ? 5 : 0);
}

export function isAvailable(physician: Physician, slot: Slot): boolean {
	if (physician.exempt && (physician.exemptFrom || physician.exemptTo)) {
		for (const date of slot.dates) {
			const afterStart = !physician.exemptFrom || date >= physician.exemptFrom;
			const beforeEnd = !physician.exemptTo || date <= physician.exemptTo;
			if (afterStart && beforeEnd) return false;
		}
	}
	for (const range of physician.unavailability) {
		for (const date of slot.dates) {
			if (date >= range.from && date <= range.to) return false;
		}
	}
	return true;
}

function buildTargets(
	physicians: Physician[],
	semester: SemesterId,
	slots: Slot[]
): Map<string, Quota> {
	const capacity = capacityByCategory(slots);
	const targets = new Map<string, Quota>();
	for (const physician of physicians) {
		targets.set(physician.id, { ...emptyQuota(), ...physician.targets[semester] });
	}
	for (const category of CATEGORIES) {
		if (capacity[category] === 0) continue;
		const total = physicians.reduce(
			(acc, physician) => acc + (targets.get(physician.id)?.[category] ?? 0),
			0
		);
		if (total === 0) {
			const split = evenSplit(capacity[category], physicians.length);
			physicians.forEach((physician, index) => {
				const target = targets.get(physician.id);
				if (target) target[category] = split[index] ?? 0;
			});
		}
	}
	return targets;
}

/**
 * Greedy fill followed by a seeded local search (reassignments + swaps).
 * Hard constraints: exemptions, unavailability, pinned slots.
 * Soft objectives: per-category targets, spacing between two shifts, fairness.
 */
export function generateSchedule(options: GenerateOptions): GenerateResult {
	const { physicians, slots, pins, seed } = options;
	const iterations = options.iterationsPerSemester ?? 18_000;
	const random = mulberry32(seed || 1);
	const assignments: Record<string, string> = {};
	const warnings: string[] = [];
	const unassigned: string[] = [];

	const active = physicians
		.filter((physician) => !isFullyExempt(physician))
		.sort((a, b) => a.sortOrder - b.sortOrder);

	if (!active.length) {
		return {
			assignments,
			unassigned: slots.map((slot) => slot.id),
			warnings: ['Aucun médecin disponible : vérifiez les exemptions et les absences.'],
			iterations: 0
		};
	}

	const bySemester: Record<SemesterId, Slot[]> = { S1: [], S2: [] };
	for (const slot of slots) bySemester[slot.semester].push(slot);

	let totalIterations = 0;
	let noCandidateCount = 0;

	for (const semester of ['S1', 'S2'] as SemesterId[]) {
		const semesterSlots = bySemester[semester];
		if (!semesterSlots.length) continue;

		const targets = buildTargets(active, semester, semesterSlots);

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
		const assignedSets = new Map<string, Set<string>>();
		const assignedLists = new Map<string, Slot[]>();
		const spacingCosts = new Map<string, number>();
		for (const physician of active) {
			counts.set(physician.id, emptyQuota());
			assignedSets.set(physician.id, new Set<string>());
			assignedLists.set(physician.id, []);
			spacingCosts.set(physician.id, 0);
		}

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
			list.splice(index, 0, slot);
		};

		const removeSlot = (physicianId: string, slot: Slot): void => {
			const set = assignedSets.get(physicianId);
			const count = counts.get(physicianId);
			const list = assignedLists.get(physicianId);
			if (!set || !count || !list || !set.delete(slot.id)) return;
			for (const category of CATEGORIES) count[category] -= slot.weights[category];

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
			list.splice(index, 1);
		};

		const localCost = (physicianId: string): number => {
			const count = counts.get(physicianId);
			const target = targets.get(physicianId);
			if (!count || !target) return 0;
			let cost = spacingCosts.get(physicianId) ?? 0;
			for (const category of CATEGORIES) {
				cost += Math.abs(count[category] - target[category]) * 100;
			}
			return cost;
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
				const count = counts.get(physicianId);
				const target = targets.get(physicianId);
				if (!count || !target) continue;

				let need = 0;
				for (const category of CATEGORIES) {
					need += slot.weights[category] * Math.max(0, target[category] - count[category]);
				}

				addSlot(physicianId, slot);
				const spacing = spacingCosts.get(physicianId) ?? 0;
				removeSlot(physicianId, slot);

				const score = need * 100 - spacing + random() * 1.5;
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
			const temperature = 350 * Math.pow(0.0008, iteration / iterations);
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

		totalIterations += iterations;

		for (const slot of semesterSlots) {
			const physicianId = bestAssignment.get(slot.id);
			if (physicianId) assignments[slot.id] = physicianId;
			else unassigned.push(slot.id);
		}
	}

	if (noCandidateCount > 0) {
		warnings.push(
			`${noCandidateCount} créneau(x) n'ont aucun médecin disponible (exemptions ou absences).`
		);
	}
	if (unassigned.length > 0) {
		warnings.push(
			`${unassigned.length} créneau(x) n'ont pas pu être attribués. Vérifiez les objectifs et les disponibilités.`
		);
	}
	if (active.length === 1) {
		warnings.push('Un seul médecin est disponible : aucune rotation possible.');
	}

	return { assignments, unassigned, warnings, iterations: totalIterations };
}
