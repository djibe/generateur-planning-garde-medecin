import { absenceDaysInYear, formatAbsence, hasAbsence } from '#lib/domain/absence.js';
import { slotLabel } from '#lib/domain/calendar.js';
import { CATEGORIES, CATEGORY_LABELS, quotaTotal, quotaMismatches } from '#lib/domain/quotas.js';
import { computeAllStats, targetDeviation } from '#lib/domain/stats.js';
import type { Physician, Profile, SemesterId, Slot } from '#lib/domain/types.js';
import { formatUnavailableWeekdays, formatWeekdayPreferences } from '#lib/domain/weekdays.js';
import { formatLong, formatMedium } from '#lib/utils/date.js';
import { downloadBlob, safeFileName } from '#lib/utils/download.js';

type CellValue = string | number | null;

interface Column {
	header: string;
	key: string;
	width: number;
}

interface SheetSpec {
	name: string;
	title: string;
	columns: Column[];
	rows: Record<string, CellValue>[];
	typeKey?: string;
}

const TYPE_FILL: Record<string, string> = {
	weekday: 'FFEEF1F7',
	friday: 'FFDFF5F1',
	saturday: 'FFFEF3C7',
	sunday: 'FFFFE4E9',
	holidayEve: 'FFF1E9FF',
	holiday: 'FFFFE8E0'
};

const TYPE_LABEL: Record<string, string> = {
	weekday: 'Semaine',
	friday: 'Vendredi',
	saturday: 'Week-end',
	sunday: 'Dimanche',
	holidayEve: 'Veille de férié',
	holiday: 'Jour férié'
};

function fileBase(profile: Profile, suffix: string): string {
	return (
		safeFileName(`planning-garde_${profile.area || profile.name}_${profile.year}_${suffix}`) +
		'.xlsx'
	);
}

async function exportSheets(fileName: string, sheets: SheetSpec[]): Promise<void> {
	const imported: any = await import('exceljs');
	const ExcelJS = imported.default ?? imported;
	const workbook = new ExcelJS.Workbook();
	workbook.creator = 'Générateur de planning de garde — RecoMédicales';
	workbook.created = new Date();

	for (const spec of sheets) {
		const sheet = workbook.addWorksheet(spec.name.slice(0, 31), {
			views: [{ state: 'frozen', ySplit: 2 }],
			pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
		});
		const columnCount = spec.columns.length;
		sheet.mergeCells(1, 1, 1, columnCount);
		const titleCell = sheet.getCell(1, 1);
		titleCell.value = spec.title;
		titleCell.font = { bold: true, size: 14, color: { argb: 'FF1D2138' } };
		titleCell.alignment = { vertical: 'middle' };
		sheet.getRow(1).height = 24;

		const headerRow = sheet.getRow(2);
		spec.columns.forEach((column, index) => {
			const cell = headerRow.getCell(index + 1);
			cell.value = column.header;
			cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
			cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4150F5' } };
			cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
			sheet.getColumn(index + 1).width = column.width;
		});
		headerRow.height = 24;

		spec.rows.forEach((row, rowIndex) => {
			const sheetRow = sheet.getRow(rowIndex + 3);
			spec.columns.forEach((column, index) => {
				const cell = sheetRow.getCell(index + 1);
				cell.value = row[column.key] ?? '';
				cell.alignment = { vertical: 'middle', wrapText: true };
			});
			if (spec.typeKey) {
				const fill = TYPE_FILL[String(row[spec.typeKey] ?? '')];
				if (fill) {
					sheetRow.eachCell((cell: any) => {
						cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
					});
				}
			}
		});

		if (spec.rows.length) {
			sheet.autoFilter = {
				from: { row: 2, column: 1 },
				to: { row: 2, column: columnCount }
			};
		}
	}

	const buffer = await workbook.xlsx.writeBuffer();
	downloadBlob(
		fileName,
		new Blob([buffer], {
			type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		})
	);
}

function sortPhysicians(profile: Profile): Physician[] {
	return [...profile.physicians].sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function exportPhysiciansWorkbook(profile: Profile, slots: Slot[]): Promise<void> {
	const physicians = sortPhysicians(profile);
	const parameterRows: Record<string, CellValue>[] = [
		{ label: 'Profil', value: profile.name },
		{ label: 'Secteur', value: profile.area || '—' },
		{ label: 'Année', value: profile.year },
		{
			label: 'Week-ends',
			value:
				profile.settings.weekendMode === 'combined'
					? '1 garde (samedi + dimanche)'
					: '2 gardes séparées'
		},
		{ label: 'Semestre 1', value: `01/01/${profile.year} – 30/06/${profile.year}` },
		{ label: 'Semestre 2', value: `01/07/${profile.year} – 31/12/${profile.year}` },
		{ label: 'Médecins', value: physicians.length },
		{ label: 'Créneaux', value: slots.length }
	];

	const mismatches = quotaMismatches(physicians, profile.year, slots);
	for (const mismatch of mismatches) {
		parameterRows.push({
			label: `Écart ${mismatch.semester} — ${CATEGORY_LABELS[mismatch.category]}`,
			value: `objectifs ${mismatch.targets} / créneaux ${mismatch.capacity}`
		});
	}

	const quotaSheet = (semester: SemesterId): SheetSpec => ({
		name: `Objectifs ${semester}`,
		title: `Objectifs ${semester} — ${profile.area || profile.name} ${profile.year}`,
		columns: [
			{ header: 'Médecin', key: 'name', width: 28 },
			...CATEGORIES.map((category) => ({
				header: CATEGORY_LABELS[category],
				key: category,
				width: 13
			})),
			{ header: 'Total', key: 'total', width: 10 }
		],
		rows: physicians.map((physician) => ({
			name: physician.name || 'Sans nom',
			...physician.targets[semester],
			total: quotaTotal(physician.targets[semester])
		}))
	});

	await exportSheets(fileBase(profile, 'parametres'), [
		{
			name: 'Paramètres',
			title: `${profile.name} — paramètres`,
			columns: [
				{ header: 'Paramètre', key: 'label', width: 32 },
				{ header: 'Valeur', key: 'value', width: 52 }
			],
			rows: parameterRows
		},
		{
			name: 'Médecins',
			title: `Médecins — ${profile.area || profile.name} ${profile.year}`,
			columns: [
				{ header: 'Nom', key: 'name', width: 30 },
				{ header: 'Téléphone', key: 'phone', width: 18 },
				{ header: 'Absence du', key: 'absenceFrom', width: 14 },
				{ header: 'Absence au', key: 'absenceTo', width: 14 },
				{ header: 'Absence (j)', key: 'absenceDays', width: 12 },
				{ header: 'Jours indisponibles', key: 'weekdays', width: 24 },
				{ header: 'Jours préférés', key: 'preferences', width: 28 }
			],
			rows: physicians.map((physician) => ({
				name: physician.name || 'Sans nom',
				phone: physician.phone,
				absenceFrom: physician.absenceFrom ? formatMedium(physician.absenceFrom) : '',
				absenceTo: physician.absenceTo ? formatMedium(physician.absenceTo) : '',
				absenceDays: absenceDaysInYear(physician, profile.year),
				weekdays: formatUnavailableWeekdays(physician) || '—',
				preferences: formatWeekdayPreferences(physician) || '—'
			}))
		},
		quotaSheet('S1'),
		quotaSheet('S2')
	]);
}

export async function exportSummaryWorkbook(profile: Profile, slots: Slot[]): Promise<void> {
	const physicians = sortPhysicians(profile);
	const stats = computeAllStats(profile, slots);
	const columns: Column[] = [
		{ header: 'Médecin', key: 'name', width: 28 },
		{ header: 'Jours', key: 'days', width: 8 },
		{ header: 'Semaine', key: 'weekday', width: 10 },
		{ header: 'Vendredi', key: 'friday', width: 10 },
		{ header: 'Samedi', key: 'saturday', width: 10 },
		{ header: 'Dimanche', key: 'sunday', width: 10 },
		{ header: 'Veille férié', key: 'holidayEve', width: 12 },
		{ header: 'Férié', key: 'holiday', width: 8 },
		{ header: 'Écart cible', key: 'deviation', width: 11 },
		{ header: 'Espacement min. (j)', key: 'minGap', width: 16 }
	];

	const sheetFor = (semester: SemesterId | 'year'): SheetSpec => {
		const rows = physicians.map((physician) => {
			const entry = stats.find((item) => item.physicianId === physician.id);
			const bucket = semester === 'year' ? entry?.year : semester === 'S1' ? entry?.S1 : entry?.S2;
			return {
				name: physician.name || 'Sans nom',
				days: bucket?.days ?? 0,
				weekday: bucket?.tags.weekday ?? 0,
				friday: bucket?.tags.friday ?? 0,
				saturday: bucket?.tags.saturday ?? 0,
				sunday: bucket?.tags.sunday ?? 0,
				holidayEve: bucket?.tags.holidayEve ?? 0,
				holiday: bucket?.tags.holiday ?? 0,
				deviation: entry ? targetDeviation(entry, semester, physician) : 0,
				minGap: entry?.minGap ?? ''
			};
		});
		const label = semester === 'year' ? 'Total année' : `Synthèse ${semester}`;
		return {
			name: label,
			title: `${label} — ${profile.area || profile.name} ${profile.year}`,
			columns,
			rows
		};
	};

	await exportSheets(fileBase(profile, 'synthese'), [
		sheetFor('S1'),
		sheetFor('S2'),
		sheetFor('year')
	]);
}

export async function exportPlanningWorkbook(profile: Profile, slots: Slot[]): Promise<void> {
	const physicianById = new Map(profile.physicians.map((physician) => [physician.id, physician]));

	const sheetFor = (semester: SemesterId): SheetSpec => ({
		name: `Planning ${semester}`,
		title: `Planning ${semester} — ${profile.area || profile.name} ${profile.year}`,
		typeKey: 'typeKey',
		columns: [
			{ header: 'Date', key: 'date', width: 22 },
			{ header: 'Jour(s)', key: 'days', width: 20 },
			{ header: 'Type', key: 'type', width: 16 },
			{ header: 'Médecin', key: 'physician', width: 28 },
			{ header: 'Téléphone', key: 'phone', width: 18 },
			{ header: 'Férié', key: 'holiday', width: 16 },
			{ header: 'Verrouillé', key: 'pinned', width: 10 }
		],
		rows: slots
			.filter((slot) => slot.semester === semester)
			.sort((a, b) => a.start.localeCompare(b.start))
			.map((slot) => {
				const physicianId = profile.assignments[semester]?.[slot.id];
				const physician = physicianId ? physicianById.get(physicianId) : undefined;
				return {
					date: formatLong(slot.start),
					days: slotLabel(slot),
					type: TYPE_LABEL[slot.type] ?? slot.type,
					typeKey: slot.type,
					physician: physician?.name || 'Non attribué',
					phone: physician?.phone ?? '',
					holiday: slot.holidayName ?? '',
					pinned: profile.pins[slot.id] ? 'oui' : ''
				};
			})
	});

	await exportSheets(fileBase(profile, 'planning'), [sheetFor('S1'), sheetFor('S2')]);
}

export async function exportDoctorWorkbook(
	profile: Profile,
	slots: Slot[],
	physicianId: string
): Promise<void> {
	const physicians = sortPhysicians(profile);
	const physician = physicians.find((item) => item.id === physicianId);
	if (!physician) return;

	const stats = computeAllStats(profile, slots).find((item) => item.physicianId === physicianId);
	const assigned = slots
		.filter((slot) => profile.assignments[slot.semester]?.[slot.id] === physicianId)
		.sort((a, b) => a.start.localeCompare(b.start));

	const summaryRows: Record<string, CellValue>[] = [
		{ label: 'Médecin', value: physician.name || 'Sans nom' },
		{ label: 'Téléphone', value: physician.phone },
		{
			label: 'Absence',
			value: hasAbsence(physician)
				? `${formatAbsence(physician)} (${absenceDaysInYear(physician, profile.year)} j)`
				: '—'
		},
		{ label: 'Jours indisponibles', value: formatUnavailableWeekdays(physician) || '—' },
		{ label: 'Jours préférés', value: formatWeekdayPreferences(physician) || '—' },
		{ label: 'Secteur', value: profile.area || profile.name },
		{ label: 'Année', value: profile.year },
		{ label: 'Jours de garde', value: stats?.year.days ?? 0 },
		{ label: 'Gardes', value: stats?.year.shifts ?? 0 },
		{ label: 'Semaines', value: stats?.year.tags.weekday ?? 0 },
		{ label: 'Vendredis', value: stats?.year.tags.friday ?? 0 },
		{ label: 'Samedis', value: stats?.year.tags.saturday ?? 0 },
		{ label: 'Dimanches', value: stats?.year.tags.sunday ?? 0 },
		{ label: 'Veilles de férié', value: stats?.year.tags.holidayEve ?? 0 },
		{ label: 'Jours fériés', value: stats?.year.tags.holiday ?? 0 },
		{ label: 'Week-ends', value: stats?.year.weekends ?? 0 },
		{ label: 'Espacement minimum (j)', value: stats?.minGap ?? '—' },
		{
			label: 'Espacement moyen (j)',
			value: stats?.avgGap ? Math.round(stats.avgGap * 10) / 10 : '—'
		}
	];

	await exportSheets(fileBase(profile, `medecin-${safeFileName(physician.name || 'sans-nom')}`), [
		{
			name: 'Récapitulatif',
			title: `${physician.name || 'Sans nom'} — ${profile.area || profile.name} ${profile.year}`,
			columns: [
				{ header: 'Indicateur', key: 'label', width: 30 },
				{ header: 'Valeur', key: 'value', width: 24 }
			],
			rows: summaryRows
		},
		{
			name: 'Planning',
			title: `Gardes de ${physician.name || 'Sans nom'} — ${profile.year}`,
			columns: [
				{ header: 'Date', key: 'date', width: 14 },
				{ header: 'Jour', key: 'weekday', width: 12 },
				{ header: 'Semestre', key: 'semester', width: 10 },
				{ header: 'Type', key: 'type', width: 16 },
				{ header: 'Férié', key: 'holiday', width: 16 }
			],
			rows: assigned.map((slot) => ({
				date: formatMedium(slot.start),
				weekday: formatLong(slot.start).split(' ')[0],
				semester: slot.semester,
				type: TYPE_LABEL[slot.type] ?? slot.type,
				holiday: slot.holidayName ?? ''
			}))
		}
	]);
}
