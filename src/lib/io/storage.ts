import { parseIndex, parseProfile, parseUi } from './schema';
import type { Profile, ProfileSummary } from '$lib/domain/types';

const PREFIX = 'gpgm:v1';

export const STORAGE_KEYS = {
	index: `${PREFIX}:index`,
	ui: `${PREFIX}:ui`,
	profile: (id: string) => `${PREFIX}:profile:${id}`,
	corrupt: (id: string) => `${PREFIX}:corrupt:${id}`
};

export interface UiState {
	theme: 'light' | 'dark';
	tab: 'medecins' | 'synthese' | 'calendrier' | 'medecin';
	doctorId: string | null;
}

export interface StoredIndex {
	activeProfileId: string | null;
	profiles: ProfileSummary[];
}

export function isStorageAvailable(): boolean {
	try {
		if (typeof localStorage === 'undefined') return false;
		const probe = `${PREFIX}:probe`;
		localStorage.setItem(probe, '1');
		localStorage.removeItem(probe);
		return true;
	} catch {
		return false;
	}
}

function readRaw(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeRaw(key: string, value: string): boolean {
	try {
		localStorage.setItem(key, value);
		return true;
	} catch {
		return false;
	}
}

export function readIndex(): StoredIndex {
	const raw = readRaw(STORAGE_KEYS.index);
	if (!raw) return { activeProfileId: null, profiles: [] };
	try {
		const parsed = parseIndex(JSON.parse(raw));
		return parsed ?? { activeProfileId: null, profiles: [] };
	} catch {
		return { activeProfileId: null, profiles: [] };
	}
}

export function writeIndex(index: StoredIndex): boolean {
	return writeRaw(STORAGE_KEYS.index, JSON.stringify(index));
}

export function readProfile(id: string): Profile | null {
	const raw = readRaw(STORAGE_KEYS.profile(id));
	if (!raw) return null;
	try {
		const parsed = parseProfile(JSON.parse(raw));
		if (!parsed) quarantineProfile(id, raw);
		return parsed;
	} catch {
		quarantineProfile(id, raw);
		return null;
	}
}

export function writeProfile(profile: Profile): boolean {
	return writeRaw(STORAGE_KEYS.profile(profile.id), JSON.stringify(profile));
}

export function writeProfileRaw(id: string, json: string): boolean {
	return writeRaw(STORAGE_KEYS.profile(id), json);
}

export function deleteStoredProfile(id: string): void {
	try {
		localStorage.removeItem(STORAGE_KEYS.profile(id));
	} catch {
		/* ignore */
	}
}

export function quarantineProfile(id: string, raw: string): void {
	writeRaw(STORAGE_KEYS.corrupt(id), raw);
}

export function readUi(): UiState | null {
	const raw = readRaw(STORAGE_KEYS.ui);
	if (!raw) return null;
	try {
		return parseUi(JSON.parse(raw));
	} catch {
		return null;
	}
}

export function writeUi(ui: UiState): boolean {
	return writeRaw(STORAGE_KEYS.ui, JSON.stringify(ui));
}

export function estimateUsage(): number {
	if (typeof localStorage === 'undefined') return 0;
	let total = 0;
	try {
		for (let index = 0; index < localStorage.length; index += 1) {
			const key = localStorage.key(index);
			if (!key || !key.startsWith(PREFIX)) continue;
			total += (localStorage.getItem(key)?.length ?? 0) * 2;
		}
	} catch {
		return 0;
	}
	return total;
}
