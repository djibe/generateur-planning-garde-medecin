import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '$lib/io/csv';
import { createPhysician } from '$lib/domain/factory';

describe('parseCsv', () => {
	it('parses the documented format with a header', () => {
		const rows = parseCsv(
			'Nom;Téléphone;Exempté\nDr Alice Martin;06 12 34 56 78;non\nDr Benoît Petit;06 98 76 54 32;oui'
		);
		expect(rows).toEqual([
			{ name: 'Dr Alice Martin', phone: '06 12 34 56 78', exempt: false },
			{ name: 'Dr Benoît Petit', phone: '06 98 76 54 32', exempt: true }
		]);
	});

	it('accepts a file without header', () => {
		const rows = parseCsv('Dr A;0601\nDr B;0602');
		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({ name: 'Dr A', phone: '0601', exempt: false });
	});

	it('detects commas and tabs', () => {
		expect(parseCsv('name,phone\nDr A,0601')[0].name).toBe('Dr A');
		expect(parseCsv('Nom\tTéléphone\nDr A\t0601')[0].phone).toBe('0601');
	});

	it('handles quoted values containing the delimiter', () => {
		const rows = parseCsv('"Dr; A";"06;01";oui');
		expect(rows[0]).toEqual({ name: 'Dr; A', phone: '06;01', exempt: true });
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
		const first = createPhysician(1, 'Dr A', '0601');
		const second = createPhysician(2, 'Dr B', '0602', true);
		const csv = toCsv([second, first]);
		expect(csv.split('\r\n')[0]).toBe('Nom;Téléphone;Exempté');
		const parsed = parseCsv(csv);
		expect(parsed).toEqual([
			{ name: 'Dr A', phone: '0601', exempt: false },
			{ name: 'Dr B', phone: '0602', exempt: true }
		]);
	});
});
