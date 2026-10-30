import { describe, expect, it } from 'vitest';
import {
	CATEGORIES,
	capacityByCategory,
	emptyQuota,
	equitableTargets,
	evenSplit,
	normalizeToTotal,
	quotaTotal
} from '#lib/domain/quotas.js';
import { createPhysician } from '#lib/domain/factory.js';
import type { SemesterId, Slot } from '#lib/domain/types.js';

function slot(
	iso: string,
	semester: SemesterId,
	type: Slot['type'],
	weights: Partial<Record<(typeof CATEGORIES)[number], number>>
): Slot {
	return {
		id: `${semester}:${iso}`,
		semester,
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

describe('capacity and equitable targets', () => {
	it('sums the slot weights per category', () => {
		const capacity = capacityByCategory([
			slot('2026-05-04', 'S1', 'weekday', { weekday: 1 }),
			slot('2026-05-02', 'S1', 'saturday', { saturday: 1 }),
			slot('2026-05-03', 'S1', 'sunday', { sunday: 1 })
		]);
		expect(capacity.weekday).toBe(1);
		expect(capacity.saturday).toBe(1);
		expect(capacity.sunday).toBe(1);
		expect(quotaTotal(capacity)).toBe(3);
	});

	it('splits a category equally between available physicians', () => {
		const first = createPhysician(1, 'A');
		const second = createPhysician(2, 'B');
		const slots = Array.from({ length: 10 }, (_, index) =>
			slot(`2026-05-${String(index + 4).padStart(2, '0')}`, 'S1', 'weekday', {
				weekday: 1
			})
		);
		const targets = equitableTargets([first, second], 2026, slots);
		expect(targets.S1.get(first.id)?.weekday).toBe(5);
		expect(targets.S1.get(second.id)?.weekday).toBe(5);
		expect(targets.year.get(first.id)?.weekday).toBe(5);
		expect(targets.year.get(second.id)?.weekday).toBe(5);
	});

	it('prorates by the absence duration', () => {
		const full = createPhysician(1, 'Disponible');
		const half = createPhysician(2, 'Absent');
		half.absenceFrom = '2026-01-01';
		half.absenceTo = '2026-03-31';
		const slots = [slot('2026-05-04', 'S1', 'weekday', { weekday: 10 })];
		const targets = equitableTargets([full, half], 2026, slots);
		const fullTarget = targets.S1.get(full.id)?.weekday ?? 0;
		const halfTarget = targets.S1.get(half.id)?.weekday ?? 0;
		expect(fullTarget + halfTarget).toBe(10);
		expect(fullTarget).toBeGreaterThan(halfTarget);
	});

	it('gives no target to a physician absent during the whole semester', () => {
		const full = createPhysician(1, 'Disponible');
		const absent = createPhysician(2, 'Absent');
		absent.absenceFrom = '2026-01-01';
		absent.absenceTo = '2026-06-30';
		const slots = [slot('2026-05-04', 'S1', 'weekday', { weekday: 10 })];
		const targets = equitableTargets([full, absent], 2026, slots);
		expect(targets.S1.get(absent.id)?.weekday).toBe(0);
		expect(targets.S1.get(full.id)?.weekday).toBe(10);
	});

	it('gives no target in a category the physician can never work', () => {
		const free = createPhysician(1, 'Libre');
		const noFriday = createPhysician(2, 'Sans vendredi', '', ['ven']);
		const slots = [
			slot('2026-05-04', 'S1', 'weekday', { weekday: 1 }),
			slot('2026-05-15', 'S1', 'friday', { friday: 1 }),
			slot('2026-05-02', 'S1', 'saturday', { saturday: 1 })
		];
		const targets = equitableTargets([free, noFriday], 2026, slots);
		expect(targets.S1.get(noFriday.id)?.friday).toBe(0);
		expect(targets.S1.get(free.id)?.friday).toBe(1);
		expect(
			(targets.S1.get(noFriday.id)?.weekday ?? 0) + (targets.S1.get(free.id)?.weekday ?? 0)
		).toBe(1);
	});

	it('compensates the second semester with the actual first-semester counts', () => {
		const physicians = [createPhysician(1, 'A'), createPhysician(2, 'B'), createPhysician(3, 'C')];
		const slots = [
			...Array.from({ length: 10 }, (_, index) =>
				slot(`2026-05-${String(index + 4).padStart(2, '0')}`, 'S1', 'weekday', {
					weekday: 1
				})
			),
			...Array.from({ length: 10 }, (_, index) =>
				slot(`2026-09-${String(index + 1).padStart(2, '0')}`, 'S2', 'weekday', {
					weekday: 1
				})
			)
		];
		const previous = new Map([
			[physicians[0].id, { ...emptyQuota(), weekday: 5 }],
			[physicians[1].id, { ...emptyQuota(), weekday: 5 }],
			[physicians[2].id, { ...emptyQuota(), weekday: 0 }]
		]);
		const targets = equitableTargets(physicians, 2026, slots, previous);
		expect(targets.S2.get(physicians[0].id)?.weekday).toBe(2);
		expect(targets.S2.get(physicians[1].id)?.weekday).toBe(2);
		expect(targets.S2.get(physicians[2].id)?.weekday).toBe(6);
	});

	it('balances year totals across semesters', () => {
		const physicians = [createPhysician(1, 'A'), createPhysician(2, 'B'), createPhysician(3, 'C')];
		const slots = [
			...Array.from({ length: 10 }, (_, index) =>
				slot(`2026-05-${String(index + 4).padStart(2, '0')}`, 'S1', 'weekday', {
					weekday: 1
				})
			),
			...Array.from({ length: 10 }, (_, index) =>
				slot(`2026-09-${String(index + 1).padStart(2, '0')}`, 'S2', 'weekday', {
					weekday: 1
				})
			)
		];
		const targets = equitableTargets(physicians, 2026, slots);
		const totals = physicians
			.map(
				(physician) =>
					(targets.S1.get(physician.id)?.weekday ?? 0) +
					(targets.S2.get(physician.id)?.weekday ?? 0)
			)
			.sort((left, right) => left - right);
		expect(totals).toEqual([6, 7, 7]);
		expect(Math.max(...totals) - Math.min(...totals)).toBe(1);
	});
});
