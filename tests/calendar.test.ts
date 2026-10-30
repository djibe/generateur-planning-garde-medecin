import { describe, expect, it } from 'vitest';
import { buildSlots, groupBySemester, semestersOf, slotLabel } from '#lib/domain/calendar.js';
import { eachDay } from '#lib/utils/date.js';

describe('semestersOf', () => {
	it('splits the year into two balanced semesters', () => {
		const [first, second] = semestersOf(2026);
		expect(first).toEqual({ id: 'S1', start: '2026-01-01', end: '2026-06-30' });
		expect(second).toEqual({ id: 'S2', start: '2026-07-01', end: '2026-12-31' });
	});
});

describe('buildSlots', () => {
	for (const mode of ['split', 'combined'] as const) {
		it(`covers every day exactly once (${mode})`, () => {
			const slots = buildSlots(2026, mode);
			const dates = slots.flatMap((slot) => slot.dates);
			expect(dates).toHaveLength(365);
			expect(new Set(dates).size).toBe(365);
			expect([...dates].sort()).toEqual(eachDay('2026-01-01', '2026-12-31'));
		});
	}

	it('groups Saturday and Sunday in combined mode', () => {
		const slots = buildSlots(2026, 'combined');
		const weekend = slots.find((slot) => slot.start === '2026-01-03');
		expect(weekend?.dates).toEqual(['2026-01-03', '2026-01-04']);
		expect(weekend?.isWeekendBlock).toBe(true);
		expect(weekend?.weights.saturday).toBe(1);
		expect(weekend?.weights.sunday).toBe(1);
		expect(weekend?.tags.saturday).toBe(true);
		expect(weekend?.tags.sunday).toBe(true);
	});

	it('keeps Saturday and Sunday separate in split mode', () => {
		const slots = buildSlots(2026, 'split');
		const saturday = slots.find((slot) => slot.start === '2026-01-03');
		const sunday = slots.find((slot) => slot.start === '2026-01-04');
		expect(saturday?.dates).toEqual(['2026-01-03']);
		expect(saturday?.type).toBe('saturday');
		expect(sunday?.type).toBe('sunday');
	});

	it('assigns the primary type by priority', () => {
		const slots = buildSlots(2026, 'split');
		const byDate = new Map(slots.map((slot) => [slot.start, slot]));
		expect(byDate.get('2026-01-01')?.type).toBe('holiday'); // Thursday
		expect(byDate.get('2026-07-14')?.type).toBe('holiday'); // Tuesday
		expect(byDate.get('2026-12-24')?.type).toBe('holidayEve');
		expect(byDate.get('2026-12-31')?.type).toBe('holidayEve'); // eve of 01/01/2027
		expect(byDate.get('2026-07-17')?.type).toBe('friday');
	});

	it('tags a Friday holiday in both categories', () => {
		const slots = buildSlots(2026, 'split');
		const mayFirst = slots.find((slot) => slot.start === '2026-05-01');
		expect(mayFirst?.type).toBe('holiday');
		expect(mayFirst?.tags.holiday).toBe(true);
		expect(mayFirst?.tags.friday).toBe(true);
	});

	it('keeps a Friday holiday as a single holiday slot', () => {
		// 25/12/2026 is a Friday: no weekend block, but a full holiday weight.
		const slots = buildSlots(2026, 'combined');
		const christmas = slots.find((slot) => slot.dates.includes('2026-12-25'));
		expect(christmas?.isWeekendBlock).toBe(false);
		expect(christmas?.type).toBe('holiday');
		expect(christmas?.weights.holiday).toBe(1);
		expect(christmas?.tags.friday).toBe(true);
		expect(christmas?.holidayName).toBe('Noël');
	});

	it('counts a combined weekend containing a holiday as actual days', () => {
		// 15/08/2026 is a Saturday: the weekend block is also a holiday.
		const slots = buildSlots(2026, 'combined');
		const assumption = slots.find((slot) => slot.dates.includes('2026-08-15'));
		expect(assumption?.isWeekendBlock).toBe(true);
		expect(assumption?.type).toBe('holiday');
		expect(assumption?.weights.saturday).toBe(0);
		expect(assumption?.weights.sunday).toBe(1);
		expect(assumption?.weights.holiday).toBe(1);
		expect(assumption?.holidayName).toBe('Assomption');
	});

	it('weights exactly one day per date in both modes', () => {
		for (const mode of ['split', 'combined'] as const) {
			for (const slot of buildSlots(2026, mode)) {
				const total = Object.values(slot.weights).reduce((sum, value) => sum + value, 0);
				expect(total).toBe(slot.dates.length);
			}
		}
	});

	it('groups slots by semester', () => {
		const grouped = groupBySemester(buildSlots(2026, 'combined'));
		expect(grouped.S1.length).toBeGreaterThan(0);
		expect(grouped.S2.length).toBeGreaterThan(0);
		expect([...grouped.S1, ...grouped.S2]).toHaveLength(buildSlots(2026, 'combined').length);
	});
});

describe('slotLabel', () => {
	it('formats single days and weekends', () => {
		const slots = buildSlots(2026, 'combined');
		const weekend = slots.find((slot) => slot.start === '2026-01-03');
		expect(weekend && slotLabel(weekend)).toMatch(/sam/i);
		expect(weekend && slotLabel(weekend)).toMatch(/dim/i);
	});
});
