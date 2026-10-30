import { browser } from '$app/env';
import { isUnavailableInSemester } from '#lib/domain/absence.js';
import { buildSlots, groupBySemester, semestersOf, slotLabel } from '#lib/domain/calendar.js';
import {
	createEmptyProfile,
	createPhysician,
	inputSignature,
	profileSummary,
	uid
} from '#lib/domain/factory.js';
import { generateSchedule, isAvailable } from '#lib/domain/generator.js';
import { CATEGORIES, emptyEquitableTargets, equitableTargets } from '#lib/domain/quotas.js';
import { computeAllStats } from '#lib/domain/stats.js';
import {
	WEEKDAYS,
	canMakeWeekdayUnavailable,
	nextWeekdayPreferences,
	weekdayPossibleCategories
} from '#lib/domain/weekdays.js';
import type {
	Physician,
	Profile,
	ProfileSummary,
	SemesterId,
	Slot,
	Weekday,
	WeekdayRank,
	WeekendMode
} from '#lib/domain/types.js';
import type { CsvPhysician } from '#lib/io/csv.js';
import { buildBackup, parseBackup } from '#lib/io/json.js';
import {
	deleteStoredProfile,
	readIndex,
	readProfile,
	readUi,
	writeIndex,
	writeProfile,
	writeProfileRaw,
	writeUi,
	type UiState
} from '#lib/io/storage.js';
import { diffDays } from '#lib/utils/date.js';
import { downloadText, safeFileName } from '#lib/utils/download.js';

export type TabId = 'medecins' | 'synthese' | 'calendrier' | 'medecin';

export interface Toast {
	id: number;
	kind: 'success' | 'danger' | 'info';
	message: string;
}

const DEFAULT_UI: UiState = {
	theme: 'light',
	tab: 'medecins',
	doctorId: null
};

class AppStore {
	profiles = $state<ProfileSummary[]>([]);
	active = $state<Profile | null>(null);
	ui = $state<UiState>({ ...DEFAULT_UI });
	ready = $state(false);
	saving = $state(false);
	lastSavedAt = $state<string | null>(null);
	storageError = $state<string | null>(null);
	toasts = $state<Toast[]>([]);

	slots = $derived.by(() =>
		this.active
			? buildSlots(this.active.year, this.active.settings.weekendMode, {
					alsaceMoselle: this.active.settings.alsaceMoselle
				})
			: []
	);

	semesters = $derived.by(() => (this.active ? semestersOf(this.active.year) : []));

	slotsBySemester = $derived.by(() => groupBySemester(this.slots));

	stats = $derived.by(() => (this.active ? computeAllStats(this.active, this.slots) : []));

	statsById = $derived.by(() => new Map(this.stats.map((entry) => [entry.physicianId, entry])));

	equitable = $derived.by(() => {
		if (!this.active) return emptyEquitableTargets();
		const hasFirstSemester = Object.keys(this.active.assignments.S1).length > 0;
		const firstCounts = new Map(
			this.stats.map((entry) => [entry.physicianId, { ...entry.S1.weights }])
		);
		return equitableTargets(
			this.active.physicians,
			this.active.year,
			this.slots,
			hasFirstSemester ? firstCounts : undefined
		);
	});

	equityGap = $derived.by(() => {
		const profile = this.active;
		if (!profile) return 0;
		let max = 0;
		for (const semester of ['S1', 'S2'] as SemesterId[]) {
			const active = profile.physicians.filter(
				(physician) => !isUnavailableInSemester(physician, profile.year, semester)
			);
			const possible = new Map(
				active.map((physician) => [
					physician.id,
					weekdayPossibleCategories(physician, this.slots, semester)
				])
			);
			for (const category of CATEGORIES) {
				let maxCount = 0;
				let minCount = Number.POSITIVE_INFINITY;
				let eligibleCount = 0;
				for (const physician of active) {
					if (!possible.get(physician.id)?.has(category)) continue;
					const entry = this.statsById.get(physician.id);
					const target = this.equitable[semester].get(physician.id);
					if (!entry || !target) continue;
					const value = entry[semester].weights[category];
					max = Math.max(max, Math.abs(value - target[category]));
					maxCount = Math.max(maxCount, value);
					minCount = Math.min(minCount, value);
					eligibleCount += 1;
				}
				if (eligibleCount) max = Math.max(max, maxCount - minCount);
			}
		}
		return max;
	});

	unassignedCount = $derived.by(() => this.slots.filter((slot) => !this.assignmentOf(slot)).length);

	stale = $derived.by(
		() => !!this.active && this.active.generatedSignature !== inputSignature(this.active)
	);

	generated = $derived.by(() => !!this.active?.generatedAt);

	physicianMap = $derived.by(
		() => new Map((this.active?.physicians ?? []).map((physician) => [physician.id, physician]))
	);

	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingSave: { id: string; json: string } | null = null;
	private toastSequence = 0;

	init(): void {
		if (!browser || this.ready) return;
		this.ui = readUi() ?? { ...DEFAULT_UI };
		const index = readIndex();
		this.profiles = index.profiles;
		if (index.activeProfileId) {
			const profile = readProfile(index.activeProfileId);
			if (profile) {
				this.active = profile;
			} else {
				this.profiles = this.profiles.filter((entry) => entry.id !== index.activeProfileId);
				this.writeIndexNow();
			}
		}
		this.applyTheme();
		this.ready = true;
	}

	// ---------------------------------------------------------------- UI state

	applyTheme(): void {
		if (!browser) return;
		document.documentElement.dataset.bsTheme = this.ui.theme;
		document
			.querySelector('meta[name="theme-color"]')
			?.setAttribute('content', this.ui.theme === 'dark' ? '#0b0d18' : '#4150f5');
	}

	setTheme(theme: 'light' | 'dark'): void {
		this.ui = { ...this.ui, theme };
		this.applyTheme();
		this.persistUi();
	}

	toggleTheme(): void {
		this.setTheme(this.ui.theme === 'light' ? 'dark' : 'light');
	}

	setTab(tab: TabId): void {
		this.ui = { ...this.ui, tab };
		this.persistUi();
		if (browser) history.replaceState(null, '', `#${tab}`);
	}

	setDoctor(doctorId: string | null): void {
		this.ui = { ...this.ui, doctorId };
		this.persistUi();
	}

	persistUi(): void {
		writeUi(this.ui);
	}

	// ---------------------------------------------------------------- profiles

	createProfile(input: {
		name: string;
		area: string;
		year: number;
		alsaceMoselle?: boolean;
	}): void {
		this.flushSave();
		const profile = createEmptyProfile(input);
		writeProfile(profile);
		this.profiles = [...this.profiles, profileSummary(profile)];
		this.active = profile;
		this.ui = { ...this.ui, tab: 'medecins', doctorId: null };
		this.writeIndexNow();
		this.persistUi();
		this.notify('success', `Profil « ${profile.name} » créé.`);
	}

	selectProfile(id: string): void {
		if (this.active?.id === id) return;
		this.flushSave();
		const profile = readProfile(id);
		if (!profile) {
			this.notify('danger', 'Ce profil est introuvable ou corrompu.');
			this.profiles = this.profiles.filter((entry) => entry.id !== id);
			this.writeIndexNow();
			return;
		}
		this.active = profile;
		this.ui = { ...this.ui, doctorId: null };
		this.writeIndexNow();
		this.persistUi();
	}

	duplicateProfile(): void {
		const source = this.active;
		if (!source) return;
		this.flushSave();
		const year = source.year + 1;
		const now = new Date().toISOString();
		const copy: Profile = {
			...(JSON.parse(JSON.stringify(source)) as Profile),
			id: uid('prf'),
			name: `${source.area || source.name} — ${year}`,
			year,
			assignments: { S1: {}, S2: {} },
			pins: {},
			seed: Math.floor(Math.random() * 2_147_483_646) + 1,
			generatedAt: null,
			generatedSignature: null,
			createdAt: now,
			updatedAt: now
		};
		copy.physicians = source.physicians.map((physician) => ({
			...(JSON.parse(JSON.stringify(physician)) as Physician),
			id: uid('phy')
		}));
		writeProfile(copy);
		this.profiles = [...this.profiles, profileSummary(copy)];
		this.active = copy;
		this.ui = { ...this.ui, doctorId: null };
		this.writeIndexNow();
		this.notify('success', `Profil dupliqué pour ${year}.`);
	}

	deleteProfile(id: string): void {
		if (this.pendingSave?.id === id) {
			if (this.saveTimer) clearTimeout(this.saveTimer);
			this.saveTimer = null;
			this.pendingSave = null;
		}
		this.profiles = this.profiles.filter((entry) => entry.id !== id);
		deleteStoredProfile(id);
		if (this.active?.id === id) {
			this.active = null;
			const next = this.profiles[0];
			if (next) {
				const profile = readProfile(next.id);
				if (profile) this.active = profile;
			}
		}
		this.writeIndexNow();
		this.notify('info', 'Profil supprimé.');
	}

	updateProfileMeta(meta: { name?: string; area?: string }): void {
		const profile = this.active;
		if (!profile) return;
		if (meta.name !== undefined) profile.name = meta.name;
		if (meta.area !== undefined) profile.area = meta.area;
		this.persistIndex();
	}

	setWeekendMode(mode: WeekendMode): void {
		const profile = this.active;
		if (!profile || profile.settings.weekendMode === mode) return;
		profile.settings.weekendMode = mode;
		profile.assignments = { S1: {}, S2: {} };
		profile.pins = {};
		profile.generatedAt = null;
		profile.generatedSignature = null;
		this.notify('info', 'Mode week-end modifié : le planning doit être régénéré.');
	}

	/**
	 * Holiday scope changes the slot categories but not their ids, so existing
	 * assignments stay valid; the profile simply becomes stale until regenerated.
	 */
	setAlsaceMoselle(enabled: boolean): void {
		const profile = this.active;
		if (!profile || profile.settings.alsaceMoselle === enabled) return;
		profile.settings.alsaceMoselle = enabled;
		this.notify(
			'info',
			enabled
				? 'Alsace-Moselle activé : Vendredi saint et Saint-Étienne ajoutés. Régénérez le planning pour rééquilibrer.'
				: 'Alsace-Moselle désactivé : retour aux 11 jours fériés métropolitains. Régénérez le planning pour rééquilibrer.'
		);
	}

	// -------------------------------------------------------------- physicians

	addPhysician(name = '', phone = ''): string {
		const profile = this.active;
		if (!profile) return '';
		const order = profile.physicians.reduce(
			(max, physician) => Math.max(max, physician.sortOrder),
			0
		);
		const physician = createPhysician(order + 1, name, phone);
		profile.physicians.push(physician);
		return physician.id;
	}

	removePhysician(id: string): void {
		const profile = this.active;
		if (!profile) return;
		profile.physicians = profile.physicians.filter((physician) => physician.id !== id);
		for (const semester of ['S1', 'S2'] as SemesterId[]) {
			const map = profile.assignments[semester];
			for (const [slotId, physicianId] of Object.entries(map)) {
				if (physicianId === id) delete map[slotId];
			}
		}
		const pins = Object.fromEntries(
			Object.entries(profile.pins).filter(([, physicianId]) => physicianId !== id)
		);
		profile.pins = pins;
		if (this.ui.doctorId === id) this.setDoctor(null);
	}

	/** Moves a physician before or after another one and renumbers the whole list. */
	reorderPhysician(id: string, targetId: string, position: 'before' | 'after'): void {
		const profile = this.active;
		if (!profile || id === targetId) return;
		const ordered = [...profile.physicians].sort((a, b) => a.sortOrder - b.sortOrder);
		const from = ordered.findIndex((physician) => physician.id === id);
		if (from < 0 || !ordered.some((physician) => physician.id === targetId)) return;

		const [moved] = ordered.splice(from, 1);
		const anchor = ordered.findIndex((physician) => physician.id === targetId);
		const insertAt = position === 'before' ? anchor : anchor + 1;
		if (insertAt === from) return;

		ordered.splice(insertAt, 0, moved);
		ordered.forEach((physician, index) => {
			physician.sortOrder = index + 1;
		});
		profile.physicians = ordered;
	}

	setAbsence(physicianId: string, from: string | null, to: string | null): void {
		const physician = this.physicianMap.get(physicianId);
		if (!physician) return;
		physician.absenceFrom = from || null;
		physician.absenceTo = to || null;
	}

	clearAbsence(physicianId: string): void {
		this.setAbsence(physicianId, null, null);
	}

	/**
	 * `off` marks the weekday unavailable, a rank sets a preference, null clears both.
	 * Returns false when the 4-unavailable-days limit blocks the change.
	 */
	setWeekdayStatus(physicianId: string, day: Weekday, value: 'off' | WeekdayRank | null): boolean {
		const physician = this.physicianMap.get(physicianId);
		if (!physician) return false;
		const unavailable = new Set(physician.unavailableWeekdays ?? []);

		if (value === 'off') {
			if (!canMakeWeekdayUnavailable(physician, day)) {
				this.notify(
					'danger',
					'Maximum 4 jours indisponibles par médecin : au moins un jour de la semaine doit rester disponible.'
				);
				return false;
			}
			unavailable.add(day);
			physician.unavailableWeekdays = WEEKDAYS.filter((entry) => unavailable.has(entry));
			const preferences = { ...(physician.weekdayPreferences ?? {}) };
			delete preferences[day];
			physician.weekdayPreferences = preferences;
			return true;
		}

		if (unavailable.delete(day)) {
			physician.unavailableWeekdays = WEEKDAYS.filter((entry) => unavailable.has(entry));
		}
		physician.weekdayPreferences = nextWeekdayPreferences(
			physician.weekdayPreferences ?? {},
			day,
			value
		);
		return true;
	}

	importPhysicians(rows: CsvPhysician[], mode: 'append' | 'replace'): void {
		const profile = this.active;
		if (!profile) return;
		if (mode === 'replace') {
			profile.physicians = [];
			profile.assignments = { S1: {}, S2: {} };
			profile.pins = {};
		}
		let order = profile.physicians.reduce(
			(max, physician) => Math.max(max, physician.sortOrder),
			0
		);
		for (const row of rows) {
			order += 1;
			profile.physicians.push(
				createPhysician(
					order,
					row.name,
					row.phone,
					row.unavailableWeekdays,
					row.weekdayPreferences,
					row.absenceFrom,
					row.absenceTo
				)
			);
		}
		this.notify('success', `${rows.length} médecin(s) importé(s).`);
	}

	// ---------------------------------------------------------------- planning

	assignmentOf(slot: Slot): string | null {
		return this.active?.assignments[slot.semester]?.[slot.id] ?? null;
	}

	physicianName(id: string | null | undefined): string {
		if (!id) return 'Non attribué';
		return this.physicianMap.get(id)?.name?.trim() || 'Sans nom';
	}

	shortName(id: string | null | undefined): string {
		const name = this.physicianName(id);
		if (name === 'Non attribué' || name === 'Sans nom') return name;
		const clean = name.replace(/^dr\.?\s+/i, '').trim();
		const parts = clean.split(/\s+/).filter(Boolean);
		if (parts.length >= 2) {
			const first = parts[0];
			const last = parts[parts.length - 1];
			return `${first.charAt(0)}. ${last}`;
		}
		if (clean.length <= 14) return clean;
		return `${clean.slice(0, 12)}…`;
	}

	generate(): void {
		const profile = this.active;
		if (!profile) return;
		if (!profile.physicians.length) {
			this.notify('danger', 'Ajoutez au moins un médecin avant de générer le planning.');
			return;
		}

		const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
		const result = generateSchedule({
			year: profile.year,
			physicians: profile.physicians,
			slots: this.slots,
			pins: profile.pins,
			seed: profile.seed
		});
		const elapsed = Math.round(
			(typeof performance !== 'undefined' ? performance.now() : Date.now()) - started
		);

		const assignments: Record<SemesterId, Record<string, string>> = { S1: {}, S2: {} };
		const slotById = new Map(this.slots.map((slot) => [slot.id, slot]));
		for (const [slotId, physicianId] of Object.entries(result.assignments)) {
			const slot = slotById.get(slotId);
			if (slot) assignments[slot.semester][slotId] = physicianId;
		}

		profile.assignments = assignments;
		profile.generatedAt = new Date().toISOString();
		profile.generatedSignature = inputSignature(profile);
		profile.updatedAt = profile.generatedAt;
		profile.seed = (profile.seed + 1) >>> 0;
		profile.pins = Object.fromEntries(
			Object.entries(profile.pins).filter(([slotId]) => slotById.has(slotId))
		) as Record<string, string>;

		const assigned = Object.keys(result.assignments).length;
		this.notify(
			result.warnings.length ? 'info' : 'success',
			`Planning généré : ${assigned}/${this.slots.length} créneaux en ${elapsed} ms.`
		);
		for (const warning of result.warnings.slice(0, 2)) this.notify('danger', warning);
		this.persistIndex();
	}

	swapWithNearest(slotId: string, physicianId: string): void {
		const profile = this.active;
		if (!profile) return;
		const slot = this.slots.find((entry) => entry.id === slotId);
		if (!slot) return;
		const physician = this.physicianMap.get(physicianId);
		if (!physician) return;
		if (!isAvailable(physician, slot)) {
			this.notify(
				'danger',
				`${this.physicianName(physicianId)} est indisponible sur cette période.`
			);
			return;
		}

		const current = profile.assignments[slot.semester][slot.id];
		if (current === physicianId) return;

		const displaced = current ? this.physicianMap.get(current) : null;
		const partner = current
			? this.slots
					.filter(
						(entry) =>
							entry.semester === slot.semester &&
							profile.assignments[entry.semester][entry.id] === physicianId &&
							(!displaced || isAvailable(displaced, entry))
					)
					.sort(
						(a, b) =>
							Math.abs(diffDays(slot.start, a.start)) - Math.abs(diffDays(slot.start, b.start))
					)[0]
			: undefined;

		if (partner) {
			profile.assignments[slot.semester][slot.id] = physicianId;
			profile.assignments[partner.semester][partner.id] = current;
			profile.pins = { ...profile.pins, [slot.id]: physicianId, [partner.id]: current };
			this.notify(
				'info',
				`Échange : ${this.physicianName(current)} ↔ ${this.physicianName(physicianId)} (${slotLabel(partner)}).`
			);
		} else {
			profile.assignments[slot.semester][slot.id] = physicianId;
			profile.pins = { ...profile.pins, [slot.id]: physicianId };
			this.notify(
				'info',
				`${this.physicianName(physicianId)} prend la garde du ${slotLabel(slot)}.`
			);
		}
	}

	swapSlots(firstId: string, secondId: string): void {
		const profile = this.active;
		if (!profile || firstId === secondId) return;
		const first = this.slots.find((entry) => entry.id === firstId);
		const second = this.slots.find((entry) => entry.id === secondId);
		if (!first || !second) return;
		const firstPhysician = profile.assignments[first.semester][first.id];
		const secondPhysician = profile.assignments[second.semester][second.id];
		if (!firstPhysician || !secondPhysician) return;
		const firstDoctor = this.physicianMap.get(firstPhysician);
		const secondDoctor = this.physicianMap.get(secondPhysician);
		if (!firstDoctor || !secondDoctor) return;
		if (!isAvailable(secondDoctor, first) || !isAvailable(firstDoctor, second)) {
			this.notify(
				'danger',
				'Cet échange est impossible : l’un des médecins est indisponible sur la nouvelle date.'
			);
			return;
		}
		profile.assignments[first.semester][first.id] = secondPhysician;
		profile.assignments[second.semester][second.id] = firstPhysician;
		profile.pins = { ...profile.pins, [first.id]: secondPhysician, [second.id]: firstPhysician };
		this.notify(
			'info',
			`Échange : ${this.physicianName(firstPhysician)} ↔ ${this.physicianName(secondPhysician)}.`
		);
	}

	pin(slotId: string): void {
		const profile = this.active;
		if (!profile) return;
		const slot = this.slots.find((entry) => entry.id === slotId);
		if (!slot) return;
		const physicianId = profile.assignments[slot.semester]?.[slotId];
		if (!physicianId) {
			this.notify('info', 'Attribuez d’abord un médecin à cette garde avant de la verrouiller.');
			return;
		}
		profile.pins = { ...profile.pins, [slotId]: physicianId };
	}

	unpin(slotId: string): void {
		const profile = this.active;
		if (!profile) return;
		const next = { ...profile.pins };
		delete next[slotId];
		profile.pins = next;
	}

	unpinAll(): void {
		const profile = this.active;
		if (!profile) return;
		profile.pins = {};
		this.notify('info', 'Toutes les gardes ont été déverrouillées.');
	}

	clearPlanning(): void {
		const profile = this.active;
		if (!profile) return;
		profile.assignments = { S1: {}, S2: {} };
		profile.pins = {};
		profile.generatedAt = null;
		profile.generatedSignature = null;
		this.notify('info', 'Planning vidé.');
	}

	// --------------------------------------------------------------- persistence

	queueSave(id: string, json: string): void {
		this.pendingSave = { id, json };
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => this.flushSave(), 250);
	}

	flushSave(): void {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		const pending = this.pendingSave;
		if (!pending) return;
		this.pendingSave = null;
		const ok = writeProfileRaw(pending.id, pending.json);
		if (!ok) {
			if (!this.storageError) {
				this.storageError = 'Enregistrement impossible : espace de stockage saturé ou bloqué.';
				this.notify('danger', this.storageError);
			}
			return;
		}
		this.storageError = null;
		this.saving = true;
		this.lastSavedAt = new Date().toISOString();
		setTimeout(() => {
			this.saving = false;
		}, 600);
	}

	persistIndex(): void {
		const entries = this.profiles.map((entry) =>
			entry.id === this.active?.id && this.active ? profileSummary(this.active) : entry
		);
		this.profiles = entries;
		this.writeIndexNow();
	}

	private writeIndexNow(): void {
		writeIndex({
			activeProfileId: this.active?.id ?? null,
			profiles: this.profiles
		});
	}

	// ------------------------------------------------------------------- backup

	exportBackup(): void {
		this.flushSave();
		const profiles: Profile[] = [];
		for (const summary of this.profiles) {
			if (summary.id === this.active?.id && this.active) {
				profiles.push(this.active);
				continue;
			}
			const profile = readProfile(summary.id);
			if (profile) profiles.push(profile);
		}
		const date = new Date().toISOString().slice(0, 10);
		downloadText(`planning-garde-profils_${date}.json`, buildBackup(profiles), 'application/json');
		this.notify('success', 'Sauvegarde JSON exportée.');
	}

	importBackup(text: string): void {
		const profiles = parseBackup(text);
		if (!profiles) {
			this.notify('danger', 'Fichier JSON invalide ou vide.');
			return;
		}
		const byId = new Map(this.profiles.map((entry) => [entry.id, entry]));
		for (const profile of profiles) {
			writeProfile(profile);
			byId.set(profile.id, profileSummary(profile));
		}
		this.profiles = [...byId.values()];
		const first = profiles[0];
		if (first) {
			this.active = first;
			this.writeIndexNow();
		}
		this.notify('success', `${profiles.length} profil(s) importé(s).`);
	}

	// ------------------------------------------------------------------- toasts

	notify(kind: Toast['kind'], message: string): void {
		this.toastSequence += 1;
		const id = this.toastSequence;
		this.toasts = [...this.toasts, { id, kind, message }].slice(-3);
		setTimeout(() => this.dismissToast(id), kind === 'danger' ? 8000 : 4500);
	}

	dismissToast(id: number): void {
		this.toasts = this.toasts.filter((toast) => toast.id !== id);
	}

	exportName(profile: Profile, suffix: string): string {
		return `${safeFileName(`planning-garde_${profile.area || profile.name}_${profile.year}_${suffix}`)}.xlsx`;
	}
}

export const app = new AppStore();
