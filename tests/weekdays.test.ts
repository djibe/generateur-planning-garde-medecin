import { describe, expect, it } from 'vitest';
import { buildSlots } from '#lib/domain/calendar.js';
import { createPhysician } from '#lib/domain/factory.js';
import {
	PREFERENCE_WEIGHT,
	canMakeWeekdayUnavailable,
	formatWeekdayPreferences,
	formatWeekdayPreferencesCsv,
	nextWeekdayPreferences,
	weekdayPreferenceCost
} from '#lib/domain/weekdays.js';
import type { Weekday, WeekdayRank } from '#lib/domain/types.js';

const slots = buildSlots(2026, 'split');

function slotOn(date: string) {
	const slot = slots.find((entry) => entry.start === date);
	if (!slot) throw new Error(`No slot on ${date}`);
	return slot;
}

describe('weekdayPreferenceCost', () => {
	it('rewards rank 1 and penalises rank 5 around a neutral baseline', () => {
		const physician = createPhysician(1, 'A', '', false, [], {
			lun: 1,
			mar: 2,
			mer: 3,
			jeu: 4,
			ven: 5
		});
		const monday = slotOn('2026-05-04');
		const tuesday = slotOn('2026-05-05');
		const wednesday = slotOn('2026-05-06');
		const thursday = slotOn('2026-05-07');
		const friday = slotOn('2026-05-15');

		expect(weekdayPreferenceCost(physician, monday)).toBe(-2 * PREFERENCE_WEIGHT);
		expect(weekdayPreferenceCost(physician, tuesday)).toBe(-PREFERENCE_WEIGHT);
		expect(weekdayPreferenceCost(physician, wednesday)).toBe(0);
		expect(weekdayPreferenceCost(physician, thursday)).toBe(PREFERENCE_WEIGHT);
		expect(weekdayPreferenceCost(physician, friday)).toBe(2 * PREFERENCE_WEIGHT);
	});

	it('treats unranked days as neutral', () => {
		const physician = createPhysician(1, 'A');
		expect(weekdayPreferenceCost(physician, slotOn('2026-05-04'))).toBe(0);
	});

	it('ignores preferences on public holidays', () => {
		const physician = createPhysician(1, 'A', '', false, [], { ven: 1 });
		const holiday = slotOn('2026-05-01');
		expect(holiday.tags.holiday).toBe(true);
		expect(weekdayPreferenceCost(physician, holiday)).toBe(0);
	});

	it('ignores preferences on weekends', () => {
		const physician = createPhysician(1, 'A', '', false, [], { lun: 1 });
		const saturday = slotOn('2026-05-02');
		expect(weekdayPreferenceCost(physician, saturday)).toBe(0);
	});
});

describe('nextWeekdayPreferences', () => {
	const rank = (value: number) => value as WeekdayRank;

	it('adds a rank', () => {
		expect(nextWeekdayPreferences({}, 'lun', rank(2))).toEqual({ lun: 2 });
	});

	it('swaps ranks when the target rank is taken', () => {
		expect(nextWeekdayPreferences({ lun: 1, mar: 2 }, 'mar', rank(1))).toEqual({
			lun: 2,
			mar: 1
		});
	});

	it('frees the other day when the edited day had no rank', () => {
		expect(nextWeekdayPreferences({ lun: 1 }, 'mar', rank(1))).toEqual({ mar: 1 });
	});

	it('clears a rank', () => {
		expect(nextWeekdayPreferences({ lun: 1 }, 'lun', null)).toEqual({});
	});
});

describe('canMakeWeekdayUnavailable', () => {
	const days = (count: number): Weekday[] =>
		(['lun', 'mar', 'mer', 'jeu', 'ven'] as Weekday[]).slice(0, count);

	it('allows up to four unavailable days', () => {
		const physician = createPhysician(1, 'A', '', false, days(3));
		expect(canMakeWeekdayUnavailable(physician, 'jeu')).toBe(true);
		physician.unavailableWeekdays = days(4);
		expect(canMakeWeekdayUnavailable(physician, 'ven')).toBe(false);
	});

	it('always allows toggling an already unavailable day', () => {
		const physician = createPhysician(1, 'A', '', false, days(4));
		expect(canMakeWeekdayUnavailable(physician, 'lun')).toBe(true);
	});
});

describe('formatting', () => {
	it('formats preferences in rank order', () => {
		const physician = createPhysician(1, 'A', '', false, [], { mer: 2, lun: 1, ven: 5 });
		expect(formatWeekdayPreferences(physician)).toBe('Lundi (1), Mercredi (2), Vendredi (5)');
	});

	it('formats preferences Monday-first for CSV', () => {
		const physician = createPhysician(1, 'A', '', false, [], { ven: 5, lun: 1, mer: 2 });
		expect(formatWeekdayPreferencesCsv(physician)).toBe('lun=1,mer=2,ven=5');
	});
});
