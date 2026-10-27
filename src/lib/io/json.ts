import type { Profile } from '$lib/domain/types';
import { parseProfile } from './schema';

export interface BackupPayload {
	app: 'gpgm';
	schemaVersion: 1;
	exportedAt: string;
	profiles: Profile[];
}

export function buildBackup(profiles: Profile[]): string {
	const payload: BackupPayload = {
		app: 'gpgm',
		schemaVersion: 1,
		exportedAt: new Date().toISOString(),
		profiles
	};
	return JSON.stringify(payload, null, 2);
}

export function parseBackup(text: string): Profile[] | null {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (!raw || typeof raw !== 'object') return null;

	const candidate = raw as { profiles?: unknown; schemaVersion?: unknown };
	const list = Array.isArray(candidate.profiles) ? candidate.profiles : null;
	if (!list) return null;

	const profiles: Profile[] = [];
	for (const entry of list) {
		const profile = parseProfile(entry);
		if (profile) profiles.push(profile);
	}
	return profiles.length ? profiles : null;
}
