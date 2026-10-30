import { z } from 'zod';
import type { Profile } from '#lib/domain/types.js';

const weekdayRankSchema = z.number().int().min(1).max(5);

const weekdayPreferencesSchema = z
	.object({
		lun: weekdayRankSchema.optional(),
		mar: weekdayRankSchema.optional(),
		mer: weekdayRankSchema.optional(),
		jeu: weekdayRankSchema.optional(),
		ven: weekdayRankSchema.optional()
	})
	.default({});

const physicianSchema = z.object({
	id: z.string(),
	name: z.string().default(''),
	phone: z.string().default(''),
	absenceFrom: z.string().nullable().default(null),
	absenceTo: z.string().nullable().default(null),
	unavailableWeekdays: z.array(z.enum(['lun', 'mar', 'mer', 'jeu', 'ven'])).default([]),
	weekdayPreferences: weekdayPreferencesSchema,
	sortOrder: z.number().int().default(0)
});

const profileSchema = z.object({
	schemaVersion: z.literal(1),
	id: z.string(),
	name: z.string(),
	area: z.string().default(''),
	year: z.number().int().min(2000).max(2200),
	settings: z.object({
		weekendMode: z.enum(['combined', 'split']),
		alsaceMoselle: z.boolean().default(false)
	}),
	physicians: z.array(physicianSchema).default([]),
	assignments: z
		.object({
			S1: z.record(z.string(), z.string()).default({}),
			S2: z.record(z.string(), z.string()).default({})
		})
		.default({ S1: {}, S2: {} }),
	pins: z.record(z.string(), z.string()).default({}),
	seed: z.number().int().default(1),
	generatedAt: z.string().nullable().default(null),
	generatedSignature: z.string().nullable().default(null),
	createdAt: z.string(),
	updatedAt: z.string()
});

const summarySchema = z.object({
	id: z.string(),
	name: z.string(),
	area: z.string().default(''),
	year: z.number().int(),
	updatedAt: z.string()
});

export const indexSchema = z.object({
	activeProfileId: z.string().nullable().default(null),
	profiles: z.array(summarySchema).default([])
});

export const uiSchema = z.object({
	theme: z.enum(['light', 'dark']).default('light'),
	tab: z.enum(['medecins', 'synthese', 'calendrier', 'medecin']).default('medecins'),
	doctorId: z.string().nullable().default(null)
});

export function parseProfile(raw: unknown): Profile | null {
	const result = profileSchema.safeParse(raw);
	if (!result.success) return null;
	return result.data as unknown as Profile;
}

export function parseIndex(raw: unknown) {
	const result = indexSchema.safeParse(raw);
	return result.success ? result.data : null;
}

export function parseUi(raw: unknown) {
	const result = uiSchema.safeParse(raw);
	return result.success ? result.data : null;
}
