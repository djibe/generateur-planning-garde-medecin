<script lang="ts">
	import TypeBadge from '#lib/components/TypeBadge.svelte';
	import YearCalendar from '#lib/components/YearCalendar.svelte';
	import { absenceDaysInYear, hasAbsence } from '#lib/domain/absence.js';
	import { CATEGORIES, CATEGORY_LABELS, emptyQuota } from '#lib/domain/quotas.js';
	import type { SemesterId, Slot } from '#lib/domain/types.js';
	import { formatUnavailableWeekdays, formatWeekdayPreferences } from '#lib/domain/weekdays.js';
	import { exportDoctorWorkbook } from '#lib/io/excel.js';
	import { app } from '#lib/stores/app.svelte.js';
	import { formatLong, formatMedium } from '#lib/utils/date.js';

	let exporting = $state(false);

	const profile = $derived(app.active);
	const physicians = $derived(
		[...(profile?.physicians ?? [])].sort((left, right) => left.sortOrder - right.sortOrder)
	);

	const doctor = $derived.by(() => {
		if (!physicians.length) return null;
		return physicians.find((physician) => physician.id === app.ui.doctorId) ?? physicians[0];
	});

	const doctorStats = $derived(doctor ? (app.statsById.get(doctor.id) ?? null) : null);
	const preferenceSummary = $derived(doctor ? formatWeekdayPreferences(doctor) : '');

	const doctorSlots = $derived.by(() => {
		if (!doctor) return [] as Slot[];
		return app.slots
			.filter((slot) => app.assignmentOf(slot) === doctor.id)
			.slice()
			.sort((left, right) => left.start.localeCompare(right.start));
	});

	const years = $derived(profile?.year ?? new Date().getFullYear());

	function label(slot: Slot): string | null {
		if (!doctor) return null;
		return app.assignmentOf(slot) === doctor.id ? app.shortName(doctor.id) : null;
	}

	async function exportExcel() {
		if (!profile || !doctor) return;
		exporting = true;
		try {
			await exportDoctorWorkbook(profile, app.slots, doctor.id);
			app.notify('success', `Planning de ${doctor.name || 'ce médecin'} exporté.`);
		} catch (error) {
			console.error(error);
			app.notify('danger', 'Export Excel impossible sur ce navigateur.');
		} finally {
			exporting = false;
		}
	}

	function semesterStats(semester: SemesterId) {
		return doctorStats
			? doctorStats[semester]
			: { shifts: 0, days: 0, tags: emptyQuota(), weights: emptyQuota(), weekends: 0 };
	}
</script>

{#if !profile}
	<div class="empty-state">
		<div class="icon"><i class="bi bi-person-badge"></i></div>
		<h3>Aucun planning ouvert</h3>
	</div>
{:else if !doctor}
	<div class="app-card">
		<div class="empty-state">
			<div class="icon"><i class="bi bi-person-plus"></i></div>
			<h3>Aucun médecin</h3>
			<p class="mb-0">Ajoutez des médecins dans l’onglet « Médecins & objectifs ».</p>
		</div>
	</div>
{:else}
	<div class="d-flex flex-wrap align-items-center gap-2 mb-3 no-print">
		<div>
			<h1 class="h4 mb-0">Planning par médecin</h1>
			<p class="section-note mb-0">
				Vue filtrée des gardes, avec les mêmes totaux que la synthèse.
			</p>
		</div>
		<div class="ms-auto d-flex gap-2">
			<button type="button" class="btn btn-sm btn-outline-secondary" onclick={() => window.print()}>
				<i class="bi bi-printer me-1"></i> Imprimer
			</button>
			<button
				type="button"
				class="btn btn-sm btn-outline-secondary"
				onclick={exportExcel}
				disabled={exporting}
			>
				{#if exporting}
					<span class="spinner-border spinner-border-sm me-1"></span>
				{:else}
					<i class="bi bi-file-earmark-excel me-1"></i>
				{/if}
				Excel
			</button>
		</div>
	</div>

	<div class="d-flex flex-wrap gap-2 mb-3 no-print">
		{#each physicians as physician (physician.id)}
			<button
				type="button"
				class="btn btn-sm {doctor.id === physician.id ? 'btn-primary' : 'btn-outline-secondary'}"
				onclick={() => app.setDoctor(physician.id)}
			>
				{physician.name || 'Sans nom'}
				{#if hasAbsence(physician)}
					<i
						class="bi bi-calendar-x ms-1"
						title={`Absent du ${formatMedium(physician.absenceFrom ?? '')} au ${formatMedium(
							physician.absenceTo ?? ''
						)}`}
					></i>
				{/if}
			</button>
		{/each}
	</div>

	<section class="app-card">
		<div class="app-card-head">
			<div>
				<h2 class="mb-0">{doctor.name || 'Sans nom'}</h2>
				<div class="section-note">
					{#if doctor.phone}<i class="bi bi-telephone me-1"></i>{doctor.phone}{/if}
					{#if hasAbsence(doctor)}
						{#if doctor.phone}
							·
						{/if}
						<i class="bi bi-calendar-x me-1"></i>
						Absent du {formatMedium(doctor.absenceFrom ?? '')} au {formatMedium(
							doctor.absenceTo ?? ''
						)} ({absenceDaysInYear(doctor, years)} j)
					{/if}
					{#if doctor.unavailableWeekdays?.length}
						{#if doctor.phone || hasAbsence(doctor)}
							·
						{/if}
						<i class="bi bi-calendar-minus me-1"></i>
						Indispo. {formatUnavailableWeekdays(doctor)}
					{/if}
					{#if preferenceSummary}
						{#if doctor.phone || hasAbsence(doctor) || doctor.unavailableWeekdays?.length}
							·
						{/if}
						<i class="bi bi-star me-1"></i>
						Préf. {preferenceSummary}
					{/if}
				</div>
			</div>
			<span class="chip ms-auto"
				>{doctorSlots.length} garde{doctorSlots.length > 1 ? 's' : ''} · {doctorStats?.year.days ??
					0} jours</span
			>
		</div>
		<div class="app-card-body">
			<div class="row g-2">
				<div class="col-6 col-md-3">
					<div class="stat">
						<div class="label">Jours de garde</div>
						<div class="value">{doctorStats?.year.days ?? 0}</div>
					</div>
				</div>
				<div class="col-6 col-md-3">
					<div class="stat">
						<div class="label">Week-ends</div>
						<div class="value">{doctorStats?.year.weekends ?? 0}</div>
					</div>
				</div>
				<div class="col-6 col-md-3">
					<div class="stat">
						<div class="label">Espacement minimum</div>
						<div class="value">
							{doctorStats?.minGap === null || doctorStats?.minGap === undefined
								? '—'
								: `${doctorStats.minGap} j`}
						</div>
					</div>
				</div>
				<div class="col-6 col-md-3">
					<div class="stat">
						<div class="label">Espacement moyen</div>
						<div class="value">
							{doctorStats?.avgGap ? `${doctorStats.avgGap.toFixed(1)} j` : '—'}
						</div>
					</div>
				</div>
			</div>

			<div class="table-responsive mt-3">
				<table class="table table-sm align-middle mb-0">
					<thead>
						<tr>
							<th>Période</th>
							<th class="text-center">Jours</th>
							<th class="text-center">Gardes</th>
							{#each CATEGORIES as category (category)}
								<th class="text-center" title={CATEGORY_LABELS[category]}
									>{CATEGORY_LABELS[category]}</th
								>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each ['S1', 'S2'] as semester (semester)}
							{@const entry = semesterStats(semester as SemesterId)}
							<tr>
								<td class="fw-medium">Semestre {semester === 'S1' ? '1' : '2'}</td>
								<td class="text-center mono">{entry.days}</td>
								<td class="text-center mono">{entry.shifts}</td>
								{#each CATEGORIES as category (category)}
									<td class="text-center mono">{entry.tags[category]}</td>
								{/each}
							</tr>
						{/each}
						<tr class="fw-semibold">
							<td>Année {years}</td>
							<td class="text-center mono">{doctorStats?.year.days ?? 0}</td>
							<td class="text-center mono">{doctorStats?.year.shifts ?? 0}</td>
							{#each CATEGORIES as category (category)}
								<td class="text-center mono">{doctorStats?.year.tags[category] ?? 0}</td>
							{/each}
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	</section>

	<section class="app-card mt-3">
		<div class="app-card-head">
			<h2><i class="bi bi-calendar3 me-2"></i>Calendrier {years}</h2>
			<span class="section-note ms-auto">Les gardes des autres médecins apparaissent en fondu.</span
			>
		</div>
		<div class="app-card-body">
			<YearCalendar year={years} slots={app.slots} {label} />
		</div>
	</section>

	<section class="app-card mt-3">
		<div class="app-card-head">
			<h2><i class="bi bi-list-check me-2"></i>Liste des gardes</h2>
			<span class="chip ms-auto">{doctorSlots.length}</span>
		</div>
		<div class="app-card-body tight">
			{#if !doctorSlots.length}
				<div class="empty-state">
					<div class="icon"><i class="bi bi-calendar-x"></i></div>
					<h3>Aucune garde attribuée</h3>
					<p class="mb-0">Générez le planning ou attribuez des gardes depuis le calendrier.</p>
				</div>
			{:else}
				<div class="table-responsive planning-list">
					<table class="table table-sm align-middle">
						<thead>
							<tr>
								<th>Date</th>
								<th>Type</th>
								<th>Férié</th>
								<th>Semestre</th>
								<th class="text-center">Verrou</th>
							</tr>
						</thead>
						<tbody>
							{#each doctorSlots as slot (slot.id)}
								<tr>
									<td class="text-nowrap">
										<div class="fw-medium">{formatLong(slot.start)}</div>
										{#if slot.isWeekendBlock}
											<div class="small text-secondary">jusqu’au {formatMedium(slot.end)}</div>
										{/if}
									</td>
									<td><TypeBadge type={slot.type} weekend={slot.isWeekendBlock} /></td>
									<td class="small text-secondary">{slot.holidayName ?? '—'}</td>
									<td class="mono">{slot.semester}</td>
									<td class="text-center">
										<button
											type="button"
											class="btn btn-sm {profile.pins[slot.id]
												? 'btn-primary'
												: 'btn-outline-secondary'}"
											title={profile.pins[slot.id] ? 'Déverrouiller' : 'Verrouiller'}
											onclick={() =>
												profile.pins[slot.id] ? app.unpin(slot.id) : app.pin(slot.id)}
										>
											<i class="bi {profile.pins[slot.id] ? 'bi-lock-fill' : 'bi-unlock'}"></i>
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	</section>
{/if}
