import { describe, expect, it } from 'vitest';
import { easterSunday, holidaysForYear, holidayMap } from '#lib/domain/holidays.js';

describe('easterSunday', () => {
	it('matches known Gregorian dates', () => {
		expect(easterSunday(2024)).toBe('2024-03-31');
		expect(easterSunday(2025)).toBe('2025-04-20');
		expect(easterSunday(2026)).toBe('2026-04-05');
		expect(easterSunday(2027)).toBe('2027-03-28');
	});
});

describe('holidaysForYear', () => {
	it('returns the 11 French metropolitan holidays', () => {
		expect(holidaysForYear(2026)).toHaveLength(11);
	});

	it('computes the movable holidays of 2026', () => {
		const dates = holidaysForYear(2026).map((holiday) => holiday.date);
		expect(dates).toContain('2026-01-01');
		expect(dates).toContain('2026-04-06'); // Lundi de Pâques
		expect(dates).toContain('2026-05-01');
		expect(dates).toContain('2026-05-08');
		expect(dates).toContain('2026-05-14'); // Ascension
		expect(dates).toContain('2026-05-25'); // Lundi de Pentecôte
		expect(dates).toContain('2026-07-14');
		expect(dates).toContain('2026-08-15');
		expect(dates).toContain('2026-11-01');
		expect(dates).toContain('2026-11-11');
		expect(dates).toContain('2026-12-25');
	});

	it('is sorted and unique', () => {
		const dates = holidaysForYear(2026).map((holiday) => holiday.date);
		expect([...dates].sort()).toEqual(dates);
		expect(new Set(dates).size).toBe(dates.length);
	});

	it('exposes the next year 1st of January for eve detection', () => {
		const map = holidayMap(2026);
		expect(map.get('2026-12-25')).toBe('Noël');
		expect(map.get('2027-01-01')).toBe("Jour de l'an");
	});
});
