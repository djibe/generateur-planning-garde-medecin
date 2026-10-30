import { describe, expect, it } from 'vitest';
import {
	CATEGORIES,
	adjustTargets,
	averageTargets,
	capacityByCategory,
	emptyQuota,
	evenSplit,
	normalizeToTotal,
	quotaTotal,
	quotaMismatches,
	targetsByCategory
} from '#lib/domain/quotas.js';
import { createPhysician } from '#lib/domain/factory.js';
import type { Slot } from '#lib/domain/types.js';

function slot(weights: Partial<Record<(typeof CATEGORIES)[number], number>>): Slot {
	return {
		id: 'S1:test',
		semester: 'S1',
		start: '2026-01-01',
		end: '2026-01-01',
		dates: ['2026-01-01'],
		type: 'weekday',
		weights: { ...emptyQuota(), ...weights },
		tags: {
			weekday: false,
			friday: false,
			saturday: false,
			sunday: false,
			holidayEve: false,
			holiday: false
		},
		isWeekendBlock: false,
		holidayName: null
	};
}

describe('evenSplit', () => {
	it('distributes the remainder to the first physicians', () => {
		expect(evenSplit(10, 3)).toEqual([4, 3, 3]);
		expect(evenSplit(0, 4)).toEqual([0, 0, 0, 0]);
		expect(evenSplit(5, 0)).toEqual([]);
	});
});

describe('normalizeToTotal', () => {
	it('keeps the total and the proportions', () => {
		expect(normalizeToTotal([1, 1, 1], 10)).toEqual([4, 3, 3]);
		expect(normalizeToTotal([6, 3, 1], 10)).toEqual([6, 3, 1]);
		expect(normalizeToTotal([0, 0, 0], 9)).toEqual([3, 3, 3]);
		expect(normalizeToTotal([2, 2], 5).reduce((sum, value) => sum + value, 0)).toBe(5);
	});
});

describe('capacity and targets', () => {
	it('sums the slot weights per category', () => {
		const capacity = capacityByCategory([slot({ weekday: 1 }), slot({ saturday: 1, sunday: 1 })]);
		expect(capacity.weekday).toBe(1);
		expect(capacity.saturday).toBe(1);
		expect(capacity.sunday).toBe(1);
		expect(quotaTotal(capacity)).toBe(3);
	});

	it('ignores physicians absent all year in the targets', () => {
		const first = createPhysician(1, 'A');
		const second = createPhysician(2, 'B');
		first.targets.S1.weekday = 4;
		second.targets.S1.weekday = 6;
		second.absenceFrom = '2026-01-01';
		second.absenceTo = '2026-12-31';
		expect(targetsByCategory([first, second], 2026, 'S1').weekday).toBe(4);
	});

	it('reports mismatches between capacity and targets', () => {
		const physician = createPhysician(1, 'A');
		physician.targets.S1.weekday = 3;
		const mismatches = quotaMismatches([physician], 2026, [slot({ weekday: 1 })]);
		expect(mismatches.some((mismatch) => mismatch.category === 'weekday')).toBe(true);
		expect(mismatches.find((mismatch) => mismatch.category === 'weekday')?.capacity).toBe(1);
	});
});

function datedSlot(
	iso: string,
	type: Slot['type'],
	weights: Partial<Record<(typeof CATEGORIES)[number], number>>
): Slot {
	return {
		id: `S1:${iso}`,
		semester: 'S1',
		start: iso,
		end: iso,
		dates: [iso],
		type,
		weights: { ...emptyQuota(), ...weights },
		tags: {
			weekday: false,
			friday: false,
			saturday: false,
			sunday: false,
			holidayEve: false,
			holiday: false
		},
		isWeekendBlock: false,
		holidayName: null
	};
}

describe('targets and weekday restrictions', () => {
	const slots = [
		datedSlot('2026-05-04', 'weekday', { weekday: 1 }),
		datedSlot('2026-05-15', 'friday', { friday: 1 }),
		datedSlot('2026-05-02', 'saturday', { saturday: 1 })
	];

	it('gives no target in a category the physician can never work', () => {
		const free = createPhysician(1, 'Libre');
		const noFriday = createPhysician(2, 'Sans vendredi', '', ['ven']);
		averageTargets([free, noFriday], 2026, 'S1', capacityByCategory(slots, 'S1'), slots);
		expect(noFriday.targets.S1.friday).toBe(0);
		expect(free.targets.S1.friday).toBe(1);
		expect(noFriday.targets.S1.weekday + free.targets.S1.weekday).toBe(1);
		expect(noFriday.targets.S1.saturday + free.targets.S1.saturday).toBe(1);
	});

	it('zeroes the impossible target when adjusting existing values', () => {
		const free = createPhysician(1, 'Libre');
		free.targets.S1.friday = 2;
		const noFriday = createPhysician(2, 'Sans vendredi', '', ['ven']);
		noFriday.targets.S1.friday = 5;
		const fridayOnly = [datedSlot('2026-05-15', 'friday', { friday: 3 })];
		adjustTargets([free, noFriday], 2026, 'S1', capacityByCategory(fridayOnly, 'S1'), fridayOnly);
		expect(noFriday.targets.S1.friday).toBe(0);
		expect(free.targets.S1.friday).toBe(3);
	});

	it('keeps every category when no weekday is restricted', () => {
		const free = createPhysician(1, 'Libre');
		averageTargets([free], 2026, 'S1', capacityByCategory(slots, 'S1'), slots);
		expect(free.targets.S1.weekday).toBe(1);
		expect(free.targets.S1.friday).toBe(1);
		expect(free.targets.S1.saturday).toBe(1);
	});

	it('prorates the targets by the absence duration in the semester', () => {
		const full = createPhysician(1, 'Disponible');
		const half = createPhysician(2, 'Absent');
		half.absenceFrom = '2026-01-01';
		half.absenceTo = '2026-03-31';
		const weekdaySlots = [datedSlot('2026-05-04', 'weekday', { weekday: 10 })];
		averageTargets([full, half], 2026, 'S1', capacityByCategory(weekdaySlots, 'S1'), weekdaySlots);
		expect(full.targets.S1.weekday + half.targets.S1.weekday).toBe(10);
		expect(full.targets.S1.weekday).toBeGreaterThan(half.targets.S1.weekday);
		expect(half.targets.S1.weekday).toBe(3);
	});

	it('gives no target at all to a physician absent during the whole semester', () => {
		const full = createPhysician(1, 'Disponible');
		const absent = createPhysician(2, 'Absent');
		absent.absenceFrom = '2026-01-01';
		absent.absenceTo = '2026-06-30';
		const weekdaySlots = [datedSlot('2026-05-04', 'weekday', { weekday: 10 })];
		averageTargets(
			[full, absent],
			2026,
			'S1',
			capacityByCategory(weekdaySlots, 'S1'),
			weekdaySlots
		);
		expect(absent.targets.S1.weekday).toBe(0);
		expect(full.targets.S1.weekday).toBe(10);
	});

	it('keeps the adjustment idempotent', () => {
		const full = createPhysician(1, 'Disponible');
		const half = createPhysician(2, 'Absent');
		half.absenceFrom = '2026-01-01';
		half.absenceTo = '2026-03-31';
		full.targets.S1.weekday = 5;
		full.targetBase!.S1.weekday = 5;
		half.targets.S1.weekday = 5;
		half.targetBase!.S1.weekday = 5;
		const weekdaySlots = [datedSlot('2026-05-04', 'weekday', { weekday: 10 })];
		adjustTargets([full, half], 2026, 'S1', capacityByCategory(weekdaySlots, 'S1'), weekdaySlots);
		const first = [full.targets.S1.weekday, half.targets.S1.weekday];
		adjustTargets([full, half], 2026, 'S1', capacityByCategory(weekdaySlots, 'S1'), weekdaySlots);
		expect([full.targets.S1.weekday, half.targets.S1.weekday]).toEqual(first);
	});
});
