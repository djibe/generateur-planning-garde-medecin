import { describe, expect, it } from 'vitest';
import {
	CATEGORIES,
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

	it('ignores fully exempt physicians in the targets', () => {
		const first = createPhysician(1, 'A');
		const second = createPhysician(2, 'B');
		first.targets.S1.weekday = 4;
		second.targets.S1.weekday = 6;
		second.exempt = true;
		expect(targetsByCategory([first, second], 'S1').weekday).toBe(4);
	});

	it('reports mismatches between capacity and targets', () => {
		const physician = createPhysician(1, 'A');
		physician.targets.S1.weekday = 3;
		const mismatches = quotaMismatches([physician], [slot({ weekday: 1 })]);
		expect(mismatches.some((mismatch) => mismatch.category === 'weekday')).toBe(true);
		expect(mismatches.find((mismatch) => mismatch.category === 'weekday')?.capacity).toBe(1);
	});
});
