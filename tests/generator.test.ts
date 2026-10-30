import { describe, expect, it } from 'vitest';
import { buildSlots } from '#lib/domain/calendar.js';
import { createPhysician } from '#lib/domain/factory.js';
import { generateSchedule, isAvailable } from '#lib/domain/generator.js';
import { CATEGORIES, averageTargets, capacityByCategory } from '#lib/domain/quotas.js';
import { computeAllStats } from '#lib/domain/stats.js';
import { weekdayIndex } from '#lib/utils/date.js';
import type { Profile, WeekendMode } from '#lib/domain/types.js';

function makeProfile(count = 12, mode: WeekendMode = 'combined'): Profile {
	const slots = buildSlots(2026, mode);
	const physicians = Array.from({ length: count }, (_, index) =>
		createPhysician(index + 1, `Médecin ${index + 1}`, `06000000${index}`)
	);
	averageTargets(physicians, 'S1', capacityByCategory(slots, 'S1'));
	averageTargets(physicians, 'S2', capacityByCategory(slots, 'S2'));
	return {
		schemaVersion: 1,
		id: 'test-profile',
		name: 'Test',
		area: 'Test',
		year: 2026,
		settings: { weekendMode: mode },
		physicians,
		assignments: { S1: {}, S2: {} },
		pins: {},
		seed: 1,
		generatedAt: null,
		generatedSignature: null,
		createdAt: '',
		updatedAt: ''
	};
}

function applyResult(profile: Profile, result: ReturnType<typeof generateSchedule>) {
	const byId = new Map(
		buildSlots(profile.year, profile.settings.weekendMode).map((slot) => [slot.id, slot])
	);
	for (const [slotId, physicianId] of Object.entries(result.assignments)) {
		const slot = byId.get(slotId);
		if (slot) profile.assignments[slot.semester][slotId] = physicianId;
	}
}

describe('generateSchedule', () => {
	it('fills every slot of the year', () => {
		const profile = makeProfile();
		const slots = buildSlots(2026, 'combined');
		const result = generateSchedule({
			physicians: profile.physicians,
			slots,
			pins: {},
			seed: 42
		});
		expect(result.unassigned).toEqual([]);
		expect(Object.keys(result.assignments)).toHaveLength(slots.length);
	});

	it('is deterministic for a given seed', () => {
		const profile = makeProfile(8);
		const slots = buildSlots(2026, 'combined');
		const options = { physicians: profile.physicians, slots, pins: {}, seed: 1234 };
		const first = generateSchedule(options);
		const second = generateSchedule(options);
		expect(first.assignments).toEqual(second.assignments);
	});

	it('never assigns a fully exempt physician', () => {
		const profile = makeProfile();
		const exempt = profile.physicians[0];
		exempt.exempt = true;
		const slots = buildSlots(2026, 'combined');
		const result = generateSchedule({ physicians: profile.physicians, slots, pins: {}, seed: 7 });
		expect(Object.values(result.assignments)).not.toContain(exempt.id);
	});

	it('respects unavailability ranges', () => {
		const profile = makeProfile();
		const physician = profile.physicians[1];
		physician.unavailability.push({
			id: 'u1',
			from: '2026-03-01',
			to: '2026-03-31',
			reason: 'Congés'
		});
		const slots = buildSlots(2026, 'combined');
		const result = generateSchedule({ physicians: profile.physicians, slots, pins: {}, seed: 9 });
		for (const [slotId, physicianId] of Object.entries(result.assignments)) {
			if (physicianId !== physician.id) continue;
			const slot = slots.find((entry) => entry.id === slotId);
			expect(slot?.dates.some((date) => date >= '2026-03-01' && date <= '2026-03-31')).toBeFalsy();
		}
	});

	it('keeps pinned assignments', () => {
		const profile = makeProfile();
		const slots = buildSlots(2026, 'combined');
		const slot = slots.find((entry) => entry.start === '2026-08-15');
		expect(slot).toBeTruthy();
		const physician = profile.physicians[3];
		const result = generateSchedule({
			physicians: profile.physicians,
			slots,
			pins: { [slot!.id]: physician.id },
			seed: 11
		});
		expect(result.assignments[slot!.id]).toBe(physician.id);
	});

	it('keeps the quota deviation small', () => {
		const profile = makeProfile();
		const slots = buildSlots(2026, 'combined');
		const result = generateSchedule({ physicians: profile.physicians, slots, pins: {}, seed: 5 });
		applyResult(profile, result);
		const stats = computeAllStats(profile, slots);
		for (const entry of stats) {
			const physician = profile.physicians.find((item) => item.id === entry.physicianId)!;
			for (const category of CATEGORIES) {
				const deviation =
					Math.abs(entry.S1.weights[category] - physician.targets.S1[category]) +
					Math.abs(entry.S2.weights[category] - physician.targets.S2[category]);
				expect(deviation).toBeLessThanOrEqual(4);
			}
		}
	});

	it('spaces shifts reasonably', () => {
		const profile = makeProfile();
		const slots = buildSlots(2026, 'combined');
		const result = generateSchedule({ physicians: profile.physicians, slots, pins: {}, seed: 21 });
		applyResult(profile, result);
		const stats = computeAllStats(profile, slots);
		for (const entry of stats) {
			expect(entry.minGap).not.toBeNull();
			expect(entry.minGap ?? 0).toBeGreaterThanOrEqual(3);
		}
	});

	it('never assigns a physician on their unavailable weekdays', () => {
		const profile = makeProfile();
		const physician = profile.physicians[1];
		physician.unavailableWeekdays = ['mer'];
		const slots = buildSlots(2026, 'combined');
		const result = generateSchedule({ physicians: profile.physicians, slots, pins: {}, seed: 13 });
		for (const [slotId, physicianId] of Object.entries(result.assignments)) {
			if (physicianId !== physician.id) continue;
			const slot = slots.find((entry) => entry.id === slotId);
			expect(
				slot?.dates.some((date) => weekdayIndex(date) === 2 && !slot.tags.holiday)
			).toBeFalsy();
		}
	});

	it('favours preferred weekdays when targets allow it', () => {
		const allSlots = buildSlots(2026, 'split');
		const mondays = allSlots
			.filter((slot) => weekdayIndex(slot.start) === 0 && !slot.tags.holiday)
			.slice(0, 8);
		const tuesdays = allSlots
			.filter((slot) => weekdayIndex(slot.start) === 1 && !slot.tags.holiday)
			.slice(0, 8);
		const slots = [...mondays, ...tuesdays].sort((left, right) =>
			left.start.localeCompare(right.start)
		);
		const mondayLover = createPhysician(1, 'Lundi', '', false, [], { lun: 1 });
		const tuesdayLover = createPhysician(2, 'Mardi', '', false, [], { mar: 1 });
		const result = generateSchedule({
			physicians: [mondayLover, tuesdayLover],
			slots,
			pins: {},
			seed: 3,
			iterationsPerSemester: 5000
		});
		const mondayForFirst = mondays.filter(
			(slot) => result.assignments[slot.id] === mondayLover.id
		).length;
		const mondayForSecond = mondays.filter(
			(slot) => result.assignments[slot.id] === tuesdayLover.id
		).length;
		expect(mondayForFirst).toBeGreaterThan(mondayForSecond);
	});

	it('returns warnings when nobody is available', () => {
		const profile = makeProfile(2);
		for (const physician of profile.physicians) physician.exempt = true;
		const slots = buildSlots(2026, 'combined');
		const result = generateSchedule({ physicians: profile.physicians, slots, pins: {}, seed: 1 });
		expect(result.assignments).toEqual({});
		expect(result.warnings.length).toBeGreaterThan(0);
		expect(result.unassigned).toHaveLength(slots.length);
	});
});

describe('isAvailable', () => {
	it('rejects a slot overlapping an absence', () => {
		const physician = createPhysician(1, 'A');
		physician.unavailability.push({ id: 'u1', from: '2026-05-01', to: '2026-05-10', reason: '' });
		const [slot] = buildSlots(2026, 'split').filter((entry) => entry.start === '2026-05-04');
		expect(slot).toBeTruthy();
		expect(isAvailable(physician, slot!)).toBe(false);
	});

	it('accepts a combined weekend overlapping an absence partially? no — rejects it', () => {
		const physician = createPhysician(1, 'A');
		physician.unavailability.push({ id: 'u1', from: '2026-05-03', to: '2026-05-03', reason: '' });
		const weekend = buildSlots(2026, 'combined').find((entry) => entry.start === '2026-05-02');
		expect(weekend).toBeTruthy();
		expect(isAvailable(physician, weekend!)).toBe(false);
	});

	it('rejects a period exemption', () => {
		const physician = createPhysician(1, 'A');
		physician.exempt = true;
		physician.exemptFrom = '2026-01-01';
		physician.exemptTo = '2026-06-30';
		const slot = buildSlots(2026, 'split').find((entry) => entry.start === '2026-03-04');
		expect(isAvailable(physician, slot!)).toBe(false);
	});

	it('rejects a weekday declared unavailable', () => {
		const physician = createPhysician(1, 'A');
		physician.unavailableWeekdays = ['lun'];
		const monday = buildSlots(2026, 'split').find((entry) => entry.start === '2026-05-04');
		const tuesday = buildSlots(2026, 'split').find((entry) => entry.start === '2026-05-05');
		expect(isAvailable(physician, monday!)).toBe(false);
		expect(isAvailable(physician, tuesday!)).toBe(true);
	});

	it('never blocks Saturday, Sunday or combined weekends', () => {
		const physician = createPhysician(1, 'A');
		physician.unavailableWeekdays = ['lun', 'mar', 'mer', 'jeu', 'ven'];
		const saturday = buildSlots(2026, 'split').find((entry) => entry.start === '2026-05-02');
		const sunday = buildSlots(2026, 'split').find((entry) => entry.start === '2026-05-03');
		const weekend = buildSlots(2026, 'combined').find((entry) => entry.start === '2026-05-02');
		expect(isAvailable(physician, saturday!)).toBe(true);
		expect(isAvailable(physician, sunday!)).toBe(true);
		expect(isAvailable(physician, weekend!)).toBe(true);
	});

	it('lets public holidays override the weekday rule', () => {
		const physician = createPhysician(1, 'A');
		physician.unavailableWeekdays = ['ven', 'lun'];
		const fridayHoliday = buildSlots(2026, 'split').find((entry) => entry.start === '2026-05-01');
		const mondayHoliday = buildSlots(2026, 'split').find((entry) => entry.start === '2026-04-06');
		expect(fridayHoliday?.tags.holiday).toBe(true);
		expect(mondayHoliday?.tags.holiday).toBe(true);
		expect(isAvailable(physician, fridayHoliday!)).toBe(true);
		expect(isAvailable(physician, mondayHoliday!)).toBe(true);
	});

	it('still blocks a holiday eve falling on an unavailable weekday', () => {
		const physician = createPhysician(1, 'A');
		physician.unavailableWeekdays = ['jeu'];
		const eve = buildSlots(2026, 'split').find((entry) => entry.start === '2026-05-07');
		expect(eve?.tags.holidayEve).toBe(true);
		expect(isAvailable(physician, eve!)).toBe(false);
	});
});
