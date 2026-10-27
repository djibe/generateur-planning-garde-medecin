import type { Physician } from '#lib/domain/types.js';

export interface CsvPhysician {
	name: string;
	phone: string;
	exempt: boolean;
}

const EXEMPT_VALUES = new Set(['oui', 'yes', 'true', '1', 'x', 'exempt', 'exempte', 'exemptee']);

function normalize(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim()
		.toLowerCase();
}

function detectDelimiter(text: string): string {
	const firstLine = text.split('\n')[0] ?? '';
	const candidates: Array<[string, number]> = [
		[';', firstLine.split(';').length - 1],
		[',', firstLine.split(',').length - 1],
		['\t', firstLine.split('\t').length - 1]
	];
	candidates.sort((a, b) => b[1] - a[1]);
	return candidates[0][1] > 0 ? candidates[0][0] : ';';
}

function parseRows(text: string, delimiter: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let inQuotes = false;

	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (inQuotes) {
			if (char === '"') {
				if (text[index + 1] === '"') {
					cell += '"';
					index += 1;
				} else {
					inQuotes = false;
				}
			} else {
				cell += char;
			}
		} else if (char === '"') {
			inQuotes = true;
		} else if (char === delimiter) {
			row.push(cell);
			cell = '';
		} else if (char === '\n') {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
		} else {
			cell += char;
		}
	}
	row.push(cell);
	if (row.some((value) => value.trim() !== '')) rows.push(row);
	return rows;
}

/** Imports `Nom;Téléphone;Exempté` (header optional, `;`, `,` or tab). */
export function parseCsv(text: string): CsvPhysician[] {
	const clean = text
		.replace(/^\uFEFF/, '')
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.trim();
	if (!clean) return [];

	const delimiter = detectDelimiter(clean);
	const rows = parseRows(clean, delimiter).filter((row) =>
		row.some((value) => value.trim() !== '')
	);
	if (!rows.length) return [];

	let start = 0;
	const header = rows[0].map(normalize);
	if (
		header.some((cell) =>
			['nom', 'name', 'medecin', 'docteur', 'physician', 'praticien'].includes(cell)
		)
	) {
		start = 1;
	}

	let nameIndex = 0;
	let phoneIndex = 1;
	let exemptIndex = 2;
	if (start === 1) {
		const phoneColumn = header.findIndex((cell) =>
			['telephone', 'tel', 'phone', 'portable', 'mobile'].includes(cell)
		);
		const exemptColumn = header.findIndex((cell) =>
			['exempte', 'exempt', 'exemption'].includes(cell)
		);
		if (phoneColumn >= 0) phoneIndex = phoneColumn;
		if (exemptColumn >= 0) exemptIndex = exemptColumn;
	}

	const result: CsvPhysician[] = [];
	for (let index = start; index < rows.length; index += 1) {
		const row = rows[index];
		const name = (row[nameIndex] ?? '').trim();
		if (!name) continue;
		const phone = (row[phoneIndex] ?? '').trim();
		const exempt = EXEMPT_VALUES.has(normalize(row[exemptIndex] ?? ''));
		result.push({ name, phone, exempt });
	}
	return result;
}

export function toCsv(physicians: Physician[]): string {
	const lines = ['Nom;Téléphone;Exempté'];
	for (const physician of [...physicians].sort((a, b) => a.sortOrder - b.sortOrder)) {
		const name = physician.name.replace(/;/g, ',');
		const phone = physician.phone.replace(/;/g, ',');
		lines.push(`${name};${phone};${physician.exempt ? 'oui' : 'non'}`);
	}
	return lines.join('\r\n');
}
