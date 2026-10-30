import type { Physician, Weekday, WeekdayRank } from '#lib/domain/types.js';
import {
	MAX_UNAVAILABLE_WEEKDAYS,
	WEEKDAYS,
	formatWeekdayPreferencesCsv,
	sortedWeekdays
} from '#lib/domain/weekdays.js';

export interface CsvPhysician {
	name: string;
	phone: string;
	absenceFrom: string | null;
	absenceTo: string | null;
	unavailableWeekdays: Weekday[];
	weekdayPreferences: Partial<Record<Weekday, WeekdayRank>>;
	/** Tokens that were not recognised, reported in the import preview. */
	invalidWeekdays: string[];
	invalidPreferences: string[];
	invalidAbsence: string[];
}

const WEEKDAY_VALUES = new Set<string>(WEEKDAYS);

const ABSENCE_FROM_HEADERS = ['absence du', 'absence de', 'absent du', 'absence from', 'from'];

const ABSENCE_TO_HEADERS = ['absence au', 'absent au', 'absence to', 'to'];

const DAY_HEADERS = [
	'jours indisponibles',
	'jours indisponible',
	'indisponibles',
	'indisponible',
	'indispo',
	'unavailable',
	'unavailable days',
	'jours off',
	'repos'
];

const PREFERENCE_HEADERS = [
	'jours preferes',
	'jours prefere',
	'preferences',
	'preference',
	'preferred days',
	'preferred',
	'jours pref'
];

interface RawWeekdaySelection {
	days: Weekday[];
	preferences: Array<{ day: Weekday; rank: WeekdayRank }>;
	invalidDays: string[];
	invalidPreferences: string[];
}

interface ParsedWeekdaySelection {
	weekdays: Weekday[];
	weekdayPreferences: Partial<Record<Weekday, WeekdayRank>>;
	invalidWeekdays: string[];
	invalidPreferences: string[];
}

function normalize(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim()
		.toLowerCase();
}

function validIsoDate(value: string): string | null {
	const clean = value.trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return null;
	const [year, month, day] = clean.split('-').map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return null;
	}
	return clean;
}

function parseAbsence(
	fromRaw: string,
	toRaw: string
): { from: string | null; to: string | null; invalid: string[] } {
	const fromValue = fromRaw.trim();
	const toValue = toRaw.trim();
	if (!fromValue && !toValue) return { from: null, to: null, invalid: [] };
	const from = validIsoDate(fromValue);
	const to = validIsoDate(toValue);
	if (!from || !to || from > to) {
		return {
			from: null,
			to: null,
			invalid: [fromValue, toValue].filter((value) => value !== '')
		};
	}
	return { from, to, invalid: [] };
}

/** Splits a cell into bare day codes and `day=rank` pairs. */
function tokenizeSelection(value: string): RawWeekdaySelection {
	const days: Weekday[] = [];
	const preferences: Array<{ day: Weekday; rank: WeekdayRank }> = [];
	const invalidDays: string[] = [];
	const invalidPreferences: string[] = [];

	for (const rawToken of value.split(/[\s,;/|]+/)) {
		const token = normalize(rawToken);
		if (!token) continue;
		if (token.includes('=')) {
			const [dayPart, rankPart] = token.split('=');
			const day = (dayPart ?? '').trim();
			const rank = Number(rankPart);
			if (WEEKDAY_VALUES.has(day) && Number.isInteger(rank) && rank >= 1 && rank <= 5) {
				preferences.push({ day: day as Weekday, rank: rank as WeekdayRank });
			} else {
				invalidPreferences.push(token);
			}
			continue;
		}
		if (WEEKDAY_VALUES.has(token)) days.push(token as Weekday);
		else invalidDays.push(token);
	}

	return { days, preferences, invalidDays, invalidPreferences };
}

/** Enforces the max-4 rule, unique ranks, and preferences on available days only. */
function normalizeSelection(raw: RawWeekdaySelection): ParsedWeekdaySelection {
	const uniqueDays = sortedWeekdays(raw.days);
	const weekdays = uniqueDays.slice(0, MAX_UNAVAILABLE_WEEKDAYS);
	const invalidWeekdays = [...raw.invalidDays, ...uniqueDays.slice(MAX_UNAVAILABLE_WEEKDAYS)];

	const weekdayPreferences: Partial<Record<Weekday, WeekdayRank>> = {};
	const invalidPreferences = [...raw.invalidPreferences];
	const usedDays = new Set<Weekday>();
	const usedRanks = new Set<number>();
	const ordered = [...raw.preferences].sort(
		(left, right) => WEEKDAYS.indexOf(left.day) - WEEKDAYS.indexOf(right.day)
	);

	for (const { day, rank } of ordered) {
		if (usedDays.has(day) || usedRanks.has(rank) || weekdays.includes(day)) {
			invalidPreferences.push(`${day}=${rank}`);
			continue;
		}
		weekdayPreferences[day] = rank;
		usedDays.add(day);
		usedRanks.add(rank);
	}

	return {
		weekdays,
		weekdayPreferences,
		invalidWeekdays: [...new Set(invalidWeekdays)],
		invalidPreferences: [...new Set(invalidPreferences)]
	};
}

/** Parses `lun,mar` (strict French codes, Monday–Friday only). Unknown tokens are kept for reporting. */
export function parseUnavailableWeekdays(value: string): {
	weekdays: Weekday[];
	invalid: string[];
} {
	const raw = tokenizeSelection(value);
	const normalized = normalizeSelection({ ...raw, preferences: [] });
	return {
		weekdays: normalized.weekdays,
		invalid: [
			...normalized.invalidWeekdays,
			...raw.preferences.map(({ day, rank }) => `${day}=${rank}`),
			...raw.invalidPreferences
		]
	};
}

/** Parses `lun=1,mer=3`. Bare day codes are reported as invalid preferences. */
export function parseWeekdayPreferences(value: string): {
	preferences: Partial<Record<Weekday, WeekdayRank>>;
	invalid: string[];
} {
	const raw = tokenizeSelection(value);
	const normalized = normalizeSelection({ ...raw, days: [] });
	return {
		preferences: normalized.weekdayPreferences,
		invalid: [...normalized.invalidPreferences, ...raw.days, ...raw.invalidDays]
	};
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

/** Imports `Nom;Téléphone;Absence du;Absence au;Jours indisponibles;Jours préférés`. */
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
	let absenceFromIndex: number | null = start === 0 ? 2 : null;
	let absenceToIndex: number | null = start === 0 ? 3 : null;
	let dayIndex: number | null = start === 0 ? 4 : null;
	let preferenceIndex: number | null = start === 0 ? 5 : null;
	if (start === 1) {
		const phoneColumn = header.findIndex((cell) =>
			['telephone', 'tel', 'phone', 'portable', 'mobile'].includes(cell)
		);
		const absenceFromColumn = header.findIndex((cell) => ABSENCE_FROM_HEADERS.includes(cell));
		const absenceToColumn = header.findIndex((cell) => ABSENCE_TO_HEADERS.includes(cell));
		const dayColumn = header.findIndex((cell) => DAY_HEADERS.includes(cell));
		const preferenceColumn = header.findIndex((cell) => PREFERENCE_HEADERS.includes(cell));
		if (phoneColumn >= 0) phoneIndex = phoneColumn;
		if (absenceFromColumn >= 0) absenceFromIndex = absenceFromColumn;
		if (absenceToColumn >= 0) absenceToIndex = absenceToColumn;
		if (dayColumn >= 0) dayIndex = dayColumn;
		if (preferenceColumn >= 0) preferenceIndex = preferenceColumn;
	}

	const listIndexes = [dayIndex, preferenceIndex].filter(
		(index): index is number => index !== null
	);
	const sortedListIndexes = [...listIndexes].sort((left, right) => left - right);
	const listStart = sortedListIndexes.length ? sortedListIndexes[0] : -1;
	const listsAtTail =
		start === 0 ||
		(sortedListIndexes.length > 0 &&
			sortedListIndexes[sortedListIndexes.length - 1] === header.length - 1 &&
			sortedListIndexes.every(
				(index, position) => position === 0 || index === sortedListIndexes[position - 1] + 1
			));

	const result: CsvPhysician[] = [];
	for (let index = start; index < rows.length; index += 1) {
		const row = rows[index];
		const name = (row[nameIndex] ?? '').trim();
		if (!name) continue;
		const phone = (row[phoneIndex] ?? '').trim();
		const absence = parseAbsence(
			absenceFromIndex !== null ? (row[absenceFromIndex] ?? '') : '',
			absenceToIndex !== null ? (row[absenceToIndex] ?? '') : ''
		);

		let raw: RawWeekdaySelection;
		if (listsAtTail && listStart >= 0) {
			// Commas/semicolons inside the day lists collide with the file delimiter:
			// re-join the tail and classify each token (bare day vs day=rank).
			raw = tokenizeSelection(row.slice(listStart).join(','));
		} else {
			const dayRaw = tokenizeSelection(dayIndex !== null ? (row[dayIndex] ?? '') : '');
			const preferenceRaw = tokenizeSelection(
				preferenceIndex !== null ? (row[preferenceIndex] ?? '') : ''
			);
			raw = {
				days: dayRaw.days,
				preferences: preferenceRaw.preferences,
				invalidDays: dayRaw.invalidDays,
				invalidPreferences: [
					...dayRaw.invalidPreferences,
					...dayRaw.preferences.map(({ day, rank }) => `${day}=${rank}`),
					...preferenceRaw.days,
					...preferenceRaw.invalidDays,
					...preferenceRaw.invalidPreferences
				]
			};
		}

		const parsed = normalizeSelection(raw);
		result.push({
			name,
			phone,
			absenceFrom: absence.from,
			absenceTo: absence.to,
			unavailableWeekdays: parsed.weekdays,
			weekdayPreferences: parsed.weekdayPreferences,
			invalidWeekdays: parsed.invalidWeekdays,
			invalidPreferences: parsed.invalidPreferences,
			invalidAbsence: absence.invalid
		});
	}
	return result;
}

export function toCsv(physicians: Physician[]): string {
	const lines = ['Nom;Téléphone;Absence du;Absence au;Jours indisponibles;Jours préférés'];
	for (const physician of [...physicians].sort((a, b) => a.sortOrder - b.sortOrder)) {
		const name = physician.name.replace(/;/g, ',');
		const phone = physician.phone.replace(/;/g, ',');
		const weekdays = sortedWeekdays(physician.unavailableWeekdays ?? []).join(',');
		const preferences = formatWeekdayPreferencesCsv(physician);
		const from = physician.absenceFrom ?? '';
		const to = physician.absenceTo ?? '';
		lines.push(`${name};${phone};${from};${to};${weekdays};${preferences}`);
	}
	return lines.join('\r\n');
}
