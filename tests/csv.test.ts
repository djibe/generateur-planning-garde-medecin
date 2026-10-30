import { describe, expect, it } from 'vitest';
import { parseCsv, parseUnavailableWeekdays, parseWeekdayPreferences, toCsv } from '#lib/io/csv.js';
import { createPhysician } from '#lib/domain/factory.js';

describe('parseUnavailableWeekdays', () => {
	it('accepts the strict French codes in any order', () => {
		expect(parseUnavailableWeekdays('ven,lun,mer')).toEqual({
			weekdays: ['lun', 'mer', 'ven'],
			invalid: []
		});
	});

	it('accepts several separators and de-duplicates', () => {
		expect(parseUnavailableWeekdays('lun / mar; lun | jeu jeu')).toEqual({
			weekdays: ['lun', 'mar', 'jeu'],
			invalid: []
		});
	});

	it('reports every token that is not a Monday–Friday code', () => {
		expect(parseUnavailableWeekdays('sam,dim,lundi,xyz')).toEqual({
			weekdays: [],
			invalid: ['sam', 'dim', 'lundi', 'xyz']
		});
	});

	it('handles an empty value', () => {
		expect(parseUnavailableWeekdays('')).toEqual({ weekdays: [], invalid: [] });
	});
});

describe('parseWeekdayPreferences', () => {
	it('parses explicit day=rank pairs', () => {
		expect(parseWeekdayPreferences('jeu=2,lun=1')).toEqual({
			preferences: { lun: 1, jeu: 2 },
			invalid: []
		});
	});

	it('keeps the first Monday-first occurrence of a duplicate rank', () => {
		expect(parseWeekdayPreferences('jeu=1,lun=1')).toEqual({
			preferences: { lun: 1 },
			invalid: ['jeu=1']
		});
	});

	it('rejects bare days and invalid ranks', () => {
		expect(parseWeekdayPreferences('lun,mer=6,sam=1')).toEqual({
			preferences: {},
			invalid: ['mer=6', 'sam=1', 'lun']
		});
	});

	it('handles an empty value', () => {
		expect(parseWeekdayPreferences('')).toEqual({ preferences: {}, invalid: [] });
	});
});

describe('parseCsv', () => {
	it('parses the documented format with a header', () => {
		const rows = parseCsv(
			'Nom;Téléphone;Absence du;Absence au;Jours indisponibles;Jours préférés\nDr Alice Martin;06 12 34 56 78;2026-03-01;2026-03-31;lun,mer;mar=1,jeu=2\nDr Benoît Petit;06 98 76 54 32;;;;ven=1'
		);
		expect(rows).toEqual([
			{
				name: 'Dr Alice Martin',
				phone: '06 12 34 56 78',
				absenceFrom: '2026-03-01',
				absenceTo: '2026-03-31',
				unavailableWeekdays: ['lun', 'mer'],
				weekdayPreferences: { mar: 1, jeu: 2 },
				invalidWeekdays: [],
				invalidPreferences: [],
				invalidAbsence: []
			},
			{
				name: 'Dr Benoît Petit',
				phone: '06 98 76 54 32',
				absenceFrom: null,
				absenceTo: null,
				unavailableWeekdays: [],
				weekdayPreferences: { ven: 1 },
				invalidWeekdays: [],
				invalidPreferences: [],
				invalidAbsence: []
			}
		]);
	});

	it('accepts a file without header and reads the optional columns', () => {
		const rows = parseCsv('Dr A;0601;;;lun,mer;mar=1\nDr B;0602');
		expect(rows).toHaveLength(2);
		expect(rows[0].absenceFrom).toBeNull();
		expect(rows[0].unavailableWeekdays).toEqual(['lun', 'mer']);
		expect(rows[0].weekdayPreferences).toEqual({ mar: 1 });
		expect(rows[1].unavailableWeekdays).toEqual([]);
		expect(rows[1].weekdayPreferences).toEqual({});
	});

	it('reads absence dates from the header', () => {
		const [row] = parseCsv(
			'Nom;Téléphone;Absence du;Absence au;Jours indisponibles;Jours préférés\nDr A;0601;2026-05-01;2026-05-20;;'
		);
		expect(row.absenceFrom).toBe('2026-05-01');
		expect(row.absenceTo).toBe('2026-05-20');
		expect(row.invalidAbsence).toEqual([]);
	});

	it('finds the day and preference columns through header synonyms', () => {
		expect(parseCsv('Nom;Téléphone;Indispo\nDr A;0601;mar,jeu')[0].unavailableWeekdays).toEqual([
			'mar',
			'jeu'
		]);
		expect(parseCsv('Nom;Téléphone;Préférences\nDr A;0601;jeu=1')[0].weekdayPreferences).toEqual({
			jeu: 1
		});
		expect(
			parseCsv('Name;Phone;Unavailable;Preferred days\nDr A;0601;lun;mar=2')[0].weekdayPreferences
		).toEqual({ mar: 2 });
	});

	it('keeps valid values and reports unknown tokens', () => {
		const rows = parseCsv(
			'Nom;Téléphone;Absence du;Absence au;Jours indisponibles;Jours préférés\nDr A;0601;;;lun,sam;mer=1,dim=2'
		);
		expect(rows[0].unavailableWeekdays).toEqual(['lun']);
		expect(rows[0].weekdayPreferences).toEqual({ mer: 1 });
		expect(rows[0].invalidWeekdays).toEqual(['sam']);
		expect(rows[0].invalidPreferences).toEqual(['dim=2']);
	});

	it('reports invalid or incomplete absence dates', () => {
		const [row] = parseCsv('Nom;Téléphone;Absence du;Absence au\nDr A;0601;oui;2026-02-30');
		expect(row.absenceFrom).toBeNull();
		expect(row.absenceTo).toBeNull();
		expect(row.invalidAbsence).toEqual(['oui', '2026-02-30']);
	});

	it('limits unavailability to 4 days and drops preferences on unavailable days', () => {
		const rows = parseCsv(
			'Nom;Téléphone;Absence du;Absence au;Jours indisponibles;Jours préférés\nDr A;0601;;;lun,mar,mer,jeu,ven;lun=1,ven=2'
		);
		expect(rows[0].unavailableWeekdays).toEqual(['lun', 'mar', 'mer', 'jeu']);
		// Friday is freed by the max-4 rule, so its preference becomes valid.
		expect(rows[0].weekdayPreferences).toEqual({ ven: 2 });
		expect(rows[0].invalidWeekdays).toEqual(['ven']);
		expect(rows[0].invalidPreferences).toEqual(['lun=1']);
	});

	it('rejoins day lists containing the file delimiter', () => {
		expect(
			parseCsv(
				'Nom,Téléphone,Absence du,Absence au,Jours indisponibles,Jours préférés\nDr A,0601,,,,lun,mer,mar=1'
			)[0].unavailableWeekdays
		).toEqual(['lun', 'mer']);
		expect(
			parseCsv(
				'Nom,Téléphone,Absence du,Absence au,Jours indisponibles,Jours préférés\nDr A,0601,,,,lun,mer,mar=1'
			)[0].weekdayPreferences
		).toEqual({ mar: 1 });
		expect(parseCsv('Dr A;0601;;;lun;mer')[0].unavailableWeekdays).toEqual(['lun', 'mer']);
	});

	it('detects commas and tabs', () => {
		expect(parseCsv('name,phone\nDr A,0601')[0].name).toBe('Dr A');
		expect(parseCsv('Nom\tTéléphone\nDr A\t0601')[0].phone).toBe('0601');
	});

	it('handles quoted values containing the delimiter', () => {
		const rows = parseCsv('"Dr; A";"06;01";2026-01-01;2026-01-31');
		expect(rows[0]).toEqual({
			name: 'Dr; A',
			phone: '06;01',
			absenceFrom: '2026-01-01',
			absenceTo: '2026-01-31',
			unavailableWeekdays: [],
			weekdayPreferences: {},
			invalidWeekdays: [],
			invalidPreferences: [],
			invalidAbsence: []
		});
	});

	it('ignores blank lines and empty names', () => {
		expect(parseCsv('')).toEqual([]);
		expect(parseCsv('Nom;Téléphone\n;0601\nDr A;0602\n')).toHaveLength(1);
	});

	it('strips a UTF-8 BOM', () => {
		expect(parseCsv('\uFEFFNom;Téléphone\nDr A;0601')[0].name).toBe('Dr A');
	});
});

describe('toCsv', () => {
	it('writes a round-trippable export', () => {
		const first = createPhysician(
			1,
			'Dr A',
			'0601',
			['mer', 'lun'],
			{ mar: 1, jeu: 2 },
			'2026-02-01',
			'2026-02-28'
		);
		const second = createPhysician(2, 'Dr B', '0602');
		const csv = toCsv([second, first]);
		expect(csv.split('\r\n')[0]).toBe(
			'Nom;Téléphone;Absence du;Absence au;Jours indisponibles;Jours préférés'
		);
		const parsed = parseCsv(csv);
		expect(parsed).toEqual([
			{
				name: 'Dr A',
				phone: '0601',
				absenceFrom: '2026-02-01',
				absenceTo: '2026-02-28',
				unavailableWeekdays: ['lun', 'mer'],
				weekdayPreferences: { mar: 1, jeu: 2 },
				invalidWeekdays: [],
				invalidPreferences: [],
				invalidAbsence: []
			},
			{
				name: 'Dr B',
				phone: '0602',
				absenceFrom: null,
				absenceTo: null,
				unavailableWeekdays: [],
				weekdayPreferences: {},
				invalidWeekdays: [],
				invalidPreferences: [],
				invalidAbsence: []
			}
		]);
	});
});
