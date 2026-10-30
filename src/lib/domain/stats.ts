import { diffDays } from '../utils/date';
import { CATEGORIES, emptyQuota } from './quotas';
import type {
	PhysicianSemesterStats,
	PhysicianStats,
	Profile,
	Quota,
	SemesterId,
	Slot
} from './types';

function emptySemesterStats(): PhysicianSemesterStats {
	return {
		shifts: 0,
		days: 0,
		weights: emptyQuota(),
		weekends: 0
	};
}

function emptyStats(physicianId: string): PhysicianStats {
	return {
		physicianId,
		S1: emptySemesterStats(),
		S2: emptySemesterStats(),
		year: {
			shifts: 0,
			days: 0,
			weights: emptyQuota(),
			weekends: 0
		},
		gaps: [],
		minGap: null,
		avgGap: null
	};
}

function applySlot(stats: PhysicianSemesterStats, slot: Slot): void {
	stats.shifts += 1;
	stats.days += slot.dates.length;
	if (slot.isWeekendBlock) stats.weekends += 1;
	for (const category of CATEGORIES) {
		stats.weights[category] += slot.weights[category];
	}
}

export function computeAllStats(profile: Profile, slots: Slot[]): PhysicianStats[] {
	const byId = new Map<string, PhysicianStats>();
	for (const physician of profile.physicians) byId.set(physician.id, emptyStats(physician.id));

	for (const slot of slots) {
		const physicianId = profile.assignments[slot.semester]?.[slot.id];
		if (!physicianId) continue;
		const stats = byId.get(physicianId);
		if (!stats) continue;
		applySlot(slot.semester === 'S1' ? stats.S1 : stats.S2, slot);
	}

	for (const physician of profile.physicians) {
		const stats = byId.get(physician.id);
		if (!stats) continue;
		for (const semester of [stats.S1, stats.S2]) {
			stats.year.shifts += semester.shifts;
			stats.year.days += semester.days;
			stats.year.weekends += semester.weekends;
			for (const category of CATEGORIES) {
				stats.year.weights[category] += semester.weights[category];
			}
		}

		const assigned = slots
			.filter((slot) => profile.assignments[slot.semester]?.[slot.id] === physician.id)
			.sort((a, b) => a.start.localeCompare(b.start));

		const gaps: number[] = [];
		for (let index = 1; index < assigned.length; index += 1) {
			gaps.push(diffDays(assigned[index - 1].end, assigned[index].start));
		}
		stats.gaps = gaps;
		stats.minGap = gaps.length ? Math.min(...gaps) : null;
		stats.avgGap = gaps.length ? gaps.reduce((acc, gap) => acc + gap, 0) / gaps.length : null;
	}

	return [...byId.values()];
}

export function statsFor(stats: PhysicianStats[], physicianId: string): PhysicianStats | undefined {
	return stats.find((entry) => entry.physicianId === physicianId);
}

export function quotaDeviation(actual: Quota, target: Quota): number {
	let max = 0;
	for (const category of CATEGORIES) {
		max = Math.max(max, Math.abs(actual[category] - target[category]));
	}
	return max;
}

/**
 * Maximum absolute gap between the assigned days and the equitable target for
 * the semester, or for the whole year when `semester` is `year`.
 */
export function targetDeviation(
	stats: PhysicianStats,
	semester: SemesterId | 'year',
	targets: Record<SemesterId, Quota>
): number {
	if (semester === 'year') {
		const actual = stats.year.weights;
		const target = emptyQuota();
		for (const category of CATEGORIES) {
			target[category] = targets.S1[category] + targets.S2[category];
		}
		return quotaDeviation(actual, target);
	}
	return quotaDeviation(stats[semester].weights, targets[semester]);
}
