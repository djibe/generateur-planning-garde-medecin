export type ISODate = string;

export type SemesterId = 'S1' | 'S2';

export type WeekendMode = 'combined' | 'split';

/** Weekdays that can be declared unavailable. Weekends are handled by the weekend mode. */
export type Weekday = 'lun' | 'mar' | 'mer' | 'jeu' | 'ven';

/** Preference rank for a weekday: 1 = most preferred, 5 = least preferred. */
export type WeekdayRank = 1 | 2 | 3 | 4 | 5;

/** Categories used for both targets and reports. */
export type Category = 'weekday' | 'friday' | 'saturday' | 'sunday' | 'holidayEve' | 'holiday';

export type Quota = Record<Category, number>;

export type ShiftTags = Record<Category, boolean>;

/**
 * A slot is the unit of assignment and pinning.
 * - `split` weekends: one slot per day.
 * - `combined` weekends: one slot covering Saturday + Sunday.
 */
export interface Slot {
	id: string;
	semester: SemesterId;
	start: ISODate;
	end: ISODate;
	dates: ISODate[];
	/** Primary type, used for display and sort priority. */
	type: Category;
	/** What this slot consumes from the per-category targets. */
	weights: Quota;
	/** What this slot displays in the reports (may overlap for holiday weekends). */
	tags: ShiftTags;
	isWeekendBlock: boolean;
	holidayName: string | null;
}

export interface Unavailability {
	id: string;
	from: ISODate;
	to: ISODate;
	reason: string;
}

export interface Physician {
	id: string;
	name: string;
	phone: string;
	exempt: boolean;
	exemptFrom: ISODate | null;
	exemptTo: ISODate | null;
	unavailability: Unavailability[];
	/** Year-round pattern: these weekdays are never assigned, except on public holidays. */
	unavailableWeekdays: Weekday[];
	/** Optional Monday–Friday preference ranking. Missing day = neutral. */
	weekdayPreferences: Partial<Record<Weekday, WeekdayRank>>;
	targets: Record<SemesterId, Quota>;
	sortOrder: number;
}

export interface ProfileSettings {
	weekendMode: WeekendMode;
}

export interface Profile {
	schemaVersion: 1;
	id: string;
	name: string;
	area: string;
	year: number;
	settings: ProfileSettings;
	physicians: Physician[];
	assignments: Record<SemesterId, Record<string, string>>;
	pins: Record<string, string>;
	seed: number;
	generatedAt: string | null;
	generatedSignature: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface ProfileSummary {
	id: string;
	name: string;
	area: string;
	year: number;
	updatedAt: string;
}

export interface PhysicianSemesterStats {
	shifts: number;
	days: number;
	tags: Quota;
	weights: Quota;
	weekends: number;
}

export interface PhysicianStats {
	physicianId: string;
	S1: PhysicianSemesterStats;
	S2: PhysicianSemesterStats;
	year: {
		shifts: number;
		days: number;
		tags: Quota;
		weights: Quota;
		weekends: number;
	};
	gaps: number[];
	minGap: number | null;
	avgGap: number | null;
}
