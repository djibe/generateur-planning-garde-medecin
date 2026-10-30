import { emptyQuota } from './quotas';
import { randomSeed } from './rng';
import type { Physician, Profile, ProfileSummary, Weekday, WeekdayRank } from './types';

export function uid(prefix = 'id'): string {
	const cryptoApi = globalThis.crypto;
	if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
		return `${prefix}_${cryptoApi.randomUUID()}`;
	}
	return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createPhysician(
	sortOrder: number,
	name = '',
	phone = '',
	exempt = false,
	unavailableWeekdays: Weekday[] = [],
	weekdayPreferences: Partial<Record<Weekday, WeekdayRank>> = {}
): Physician {
	return {
		id: uid('phy'),
		name,
		phone,
		exempt,
		exemptFrom: null,
		exemptTo: null,
		unavailability: [],
		unavailableWeekdays: [...unavailableWeekdays],
		weekdayPreferences: { ...weekdayPreferences },
		targets: { S1: emptyQuota(), S2: emptyQuota() },
		sortOrder
	};
}

export function createEmptyProfile(input: {
	name: string;
	area: string;
	year: number;
	physicians?: Physician[];
}): Profile {
	const now = new Date().toISOString();
	const area = input.area.trim();
	const year = input.year;
	return {
		schemaVersion: 1,
		id: uid('prf'),
		name: input.name.trim() || `Planning ${area || 'garde'} ${year}`.trim(),
		area,
		year,
		settings: { weekendMode: 'combined' },
		physicians: input.physicians ?? [],
		assignments: { S1: {}, S2: {} },
		pins: {},
		seed: randomSeed(),
		generatedAt: null,
		generatedSignature: null,
		createdAt: now,
		updatedAt: now
	};
}

export function profileSummary(profile: Profile): ProfileSummary {
	return {
		id: profile.id,
		name: profile.name,
		area: profile.area,
		year: profile.year,
		updatedAt: profile.updatedAt
	};
}

/**
 * Fingerprint of everything that changes the generated planning.
 * Names and phone numbers are intentionally excluded.
 */
export function inputSignature(profile: Profile): string {
	return JSON.stringify({
		year: profile.year,
		mode: profile.settings.weekendMode,
		physicians: [...profile.physicians]
			.sort((a, b) => a.sortOrder - b.sortOrder)
			.map((physician) => ({
				id: physician.id,
				exempt: physician.exempt,
				from: physician.exemptFrom,
				to: physician.exemptTo,
				unavailable: physician.unavailability.map((range) => [range.from, range.to]),
				unavailableWeekdays: [...(physician.unavailableWeekdays ?? [])].sort(),
				weekdayPreferences: Object.fromEntries(
					Object.entries(physician.weekdayPreferences ?? {}).sort(([left], [right]) =>
						left.localeCompare(right)
					)
				),
				targets: physician.targets
			}))
	});
}
