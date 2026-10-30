<script lang="ts">
	import { tooltip } from '#lib/actions/tooltip.js';
	import { isAbsentAllYear } from '#lib/domain/absence.js';
	import {
		CATEGORIES,
		CATEGORY_LABELS,
		CATEGORY_SHORT,
		emptyQuota,
		quotaTotal
	} from '#lib/domain/quotas.js';
	import { targetDeviation } from '#lib/domain/stats.js';
	import type { Category, Physician, SemesterId } from '#lib/domain/types.js';
	import { exportSummaryWorkbook } from '#lib/io/excel.js';
	import { app } from '#lib/stores/app.svelte.js';

	let exporting = $state(false);

	const profile = $derived(app.active);
	const physicians = $derived(
		[...(profile?.physicians ?? [])].sort((left, right) => left.sortOrder - right.sortOrder)
	);
	const statsById = $derived(app.statsById);
	const availablePhysicians = $derived(
		profile ? physicians.filter((physician) => !isAbsentAllYear(physician, profile.year)) : []
	);

	const assignedSlots = $derived(app.slots.filter((slot) => app.assignmentOf(slot)).length);
	const totalDays = $derived(
		app.slots.reduce((sum, slot) => sum + (app.assignmentOf(slot) ? slot.dates.length : 0), 0)
	);
	const daysPerPhysician = $derived(
		availablePhysicians.map((physician) => statsById.get(physician.id)?.year.days ?? 0)
	);
	const minDays = $derived(daysPerPhysician.length ? Math.min(...daysPerPhysician) : 0);
	const maxDays = $derived(daysPerPhysician.length ? Math.max(...daysPerPhysician) : 0);
	const avgDays = $derived(
		daysPerPhysician.length
			? daysPerPhysician.reduce((sum, value) => sum + value, 0) / daysPerPhysician.length
			: 0
	);
	function balanceClass(days: number, physicianId: string): string {
		const target = quotaTotal(app.equitable.year.get(physicianId) ?? emptyQuota());
		if (!target) return '';
		if (days > target + 1) return 'over';
		if (days < target - 1) return 'under';
		return '';
	}

	function bucket(physicianId: string, semester: SemesterId | 'year') {
		const entry = statsById.get(physicianId);
		if (!entry) return null;
		return semester === 'year' ? entry.year : entry[semester];
	}

	function targetsFor(physician: Physician) {
		return {
			S1: app.equitable.S1.get(physician.id) ?? emptyQuota(),
			S2: app.equitable.S2.get(physician.id) ?? emptyQuota()
		};
	}

	function deviation(physician: Physician, semester: SemesterId | 'year'): number {
		const entry = statsById.get(physician.id);
		return entry ? targetDeviation(entry, semester, targetsFor(physician)) : 0;
	}

	function maxSpread(semester: SemesterId | 'year', category: Category): number {
		if (!profile) return 0;
		let max = 0;
		for (const physician of physicians) {
			const actual = bucket(physician.id, semester)?.weights[category] ?? 0;
			const target =
				semester === 'year'
					? (app.equitable.year.get(physician.id) ?? emptyQuota())[category]
					: (app.equitable[semester].get(physician.id) ?? emptyQuota())[category];
			max = Math.max(max, Math.abs(actual - target));
		}
		return max;
	}

	function totalDaysFor(semester: SemesterId | 'year'): number {
		return physicians.reduce(
			(sum, physician) => sum + (bucket(physician.id, semester)?.days ?? 0),
			0
		);
	}

	function totalWeightFor(semester: SemesterId, category: Category): number {
		return physicians.reduce(
			(sum, physician) => sum + (statsById.get(physician.id)?.[semester].weights[category] ?? 0),
			0
		);
	}

	async function exportExcel() {
		if (!profile) return;
		exporting = true;
		try {
			await exportSummaryWorkbook(profile, app.slots);
			app.notify('success', 'Synthèse exportée en Excel.');
		} catch (error) {
			console.error(error);
			app.notify('danger', 'Export Excel impossible sur ce navigateur.');
		} finally {
			exporting = false;
		}
	}
</script>

{#if !profile}
	<div class="empty-state">
		<div class="icon"><i class="bi bi-bar-chart"></i></div>
		<h3>Aucun planning ouvert</h3>
	</div>
{:else}
	<div class="d-flex flex-wrap align-items-center gap-2 mb-3 no-print">
		<div>
			<h1 class="h4 mb-0">Synthèse & équité</h1>
			<p class="section-note mb-0">Totaux par semestre et sur l’année pour chaque médecin.</p>
		</div>
		<div class="ms-auto d-flex gap-2">
			<button
				type="button"
				class="btn btn-sm btn-outline-secondary"
				use:tooltip={'Imprimer la synthèse'}
				onclick={() => window.print()}
			>
				<i class="bi bi-printer me-1"></i> Imprimer
			</button>
			<button
				type="button"
				class="btn btn-sm btn-outline-secondary"
				use:tooltip={'Exporter la synthèse au format Excel'}
				onclick={exportExcel}
				disabled={exporting || !physicians.length}
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

	<div class="row g-2 mb-3">
		<div class="col-6 col-md-3">
			<div class="stat">
				<div class="label">Créneaux pourvus</div>
				<div class="value">
					{assignedSlots}<span class="fs-6 text-secondary">/{app.slots.length}</span>
				</div>
			</div>
		</div>
		<div class="col-6 col-md-3">
			<div class="stat">
				<div class="label">Jours couverts</div>
				<div class="value">{totalDays}</div>
			</div>
		</div>
		<div class="col-6 col-md-3">
			<div class="stat">
				<div class="label">Jours / médecin</div>
				<div class="value">
					{minDays === maxDays ? minDays : `${minDays}–${maxDays}`}
					<span class="fs-6 text-secondary">moy. {avgDays.toFixed(1)}</span>
				</div>
			</div>
		</div>
		<div class="col-6 col-md-3">
			<div class="stat">
				<div class="label">Écart de jours max.</div>
				<div class="value" class:text-warning={assignedSlots > 0 && app.equityGap > 1}>
					{assignedSlots > 0 ? app.equityGap : '—'}
				</div>
			</div>
		</div>
	</div>

	{#if !physicians.length}
		<div class="app-card">
			<div class="empty-state">
				<div class="icon"><i class="bi bi-people"></i></div>
				<h3>Aucun médecin</h3>
				<p class="mb-0">Ajoutez des médecins dans l’onglet « Médecins & objectifs ».</p>
			</div>
		</div>
	{:else}
		{#snippet semesterTable(semester: SemesterId)}
			<section class="app-card">
				<div class="app-card-head">
					<h2>
						Semestre {semester === 'S1' ? '1' : '2'}
						<span class="text-secondary fw-normal small ms-1">
							({semester === 'S1' ? '01/01' : '01/07'} – {semester === 'S1'
								? '30/06'
								: '31/12'}/{profile.year})
						</span>
					</h2>
					<span class="chip ms-auto">{totalDaysFor(semester)} jours</span>
				</div>
				<div class="app-card-body tight">
					<div class="table-responsive">
						<table class="table table-sm align-middle">
							<thead>
								<tr>
									<th>Médecin</th>
									<th class="text-center">Jours</th>
									{#each CATEGORIES as category (category)}
										<th class="text-center" title={CATEGORY_LABELS[category]}
											>{CATEGORY_SHORT[category]}</th
										>
									{/each}
									<th class="text-center">Écart équité</th>
								</tr>
							</thead>
							<tbody>
								{#each physicians as physician (physician.id)}
									{@const entry = bucket(physician.id, semester)}
									{@const offset = deviation(physician, semester)}
									<tr class:row-absent={profile && isAbsentAllYear(physician, profile.year)}>
										<td class="fw-medium text-nowrap">{physician.name || 'Sans nom'}</td>
										<td class="text-center fw-semibold mono">{entry?.days ?? 0}</td>
										{#each CATEGORIES as category (category)}
											<td class="text-center mono">{entry?.weights[category] ?? 0}</td>
										{/each}
										<td class="text-center">
											<span class:quota-mismatch={offset > 1} class:quota-ok={offset <= 1}>
												{offset > 0 ? `±${offset}` : '0'}
											</span>
										</td>
									</tr>
								{/each}
							</tbody>
							<tfoot>
								<tr>
									<th>Total</th>
									<th class="text-center mono">{totalDaysFor(semester)}</th>
									{#each CATEGORIES as category (category)}
										<th class="text-center mono">{totalWeightFor(semester, category)}</th>
									{/each}
									<th></th>
								</tr>
								<tr>
									<th>Écart cible max</th>
									<th></th>
									{#each CATEGORIES as category (category)}
										{@const spread = maxSpread(semester, category)}
										<th class="text-center mono" class:quota-mismatch={spread > 1}>
											{spread}
										</th>
									{/each}
									<th></th>
								</tr>
							</tfoot>
						</table>
					</div>
				</div>
			</section>
		{/snippet}

		{@render semesterTable('S1')}
		<div class="mt-3">{@render semesterTable('S2')}</div>

		<section class="app-card mt-3">
			<div class="app-card-head">
				<h2><i class="bi bi-calendar-range me-2"></i>Total année {profile.year}</h2>
				<span class="chip ms-auto">{totalDays} jours couverts</span>
			</div>
			<div class="app-card-body tight">
				<div class="table-responsive">
					<table class="table table-sm align-middle">
						<thead>
							<tr>
								<th>Médecin</th>
								<th class="text-center">Jours</th>
								<th class="text-center">Gardes</th>
								<th class="text-center">Week-ends</th>
								{#each CATEGORIES as category (category)}
									<th class="text-center" title={CATEGORY_LABELS[category]}
										>{CATEGORY_SHORT[category]}</th
									>
								{/each}
								<th class="text-center">Écart équité</th>
								<th class="text-center">Espacement</th>
								<th style="min-width: 9rem">Équilibre</th>
							</tr>
						</thead>
						<tbody>
							{#each physicians as physician (physician.id)}
								{@const entry = statsById.get(physician.id)}
								{@const days = entry?.year.days ?? 0}
								{@const offset = deviation(physician, 'year')}
								<tr class:row-absent={profile && isAbsentAllYear(physician, profile.year)}>
									<td class="fw-medium text-nowrap">{physician.name || 'Sans nom'}</td>
									<td class="text-center fw-semibold mono">{days}</td>
									<td class="text-center mono">{entry?.year.shifts ?? 0}</td>
									<td class="text-center mono">{entry?.year.weekends ?? 0}</td>
									{#each CATEGORIES as category (category)}
										<td class="text-center mono">{entry?.year.weights[category] ?? 0}</td>
									{/each}
									<td class="text-center">
										<span class:quota-mismatch={offset > 1} class:quota-ok={offset <= 1}>
											{offset > 0 ? `±${offset}` : '0'}
										</span>
									</td>
									<td class="text-center mono small">
										{entry?.minGap === null || entry?.minGap === undefined
											? '—'
											: `${entry.minGap} j`}
										{#if entry?.avgGap}
											<span class="text-secondary">/ {entry.avgGap.toFixed(1)} j</span>
										{/if}
									</td>
									<td>
										<div class="balance-track" title={`${days} jours`}>
											<div
												class="balance-fill {balanceClass(days, physician.id)}"
												style={`width:${maxDays > 0 ? Math.round((days / maxDays) * 100) : 0}%`}
											></div>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
						<tfoot>
							<tr>
								<th>Total</th>
								<th class="text-center mono">{totalDaysFor('year')}</th>
								<th class="text-center mono">
									{physicians.reduce(
										(sum, physician) => sum + (statsById.get(physician.id)?.year.shifts ?? 0),
										0
									)}
								</th>
								<th class="text-center mono">
									{physicians.reduce(
										(sum, physician) => sum + (statsById.get(physician.id)?.year.weekends ?? 0),
										0
									)}
								</th>
								{#each CATEGORIES as category (category)}
									<th class="text-center mono">
										{physicians.reduce(
											(sum, physician) =>
												sum + (statsById.get(physician.id)?.year.weights[category] ?? 0),
											0
										)}
									</th>
								{/each}
								<th></th>
								<th></th>
								<th></th>
							</tr>
							<tr>
								<th>Écart cible max</th>
								<th></th>
								<th></th>
								<th></th>
								{#each CATEGORIES as category (category)}
									{@const spread = maxSpread('year', category)}
									<th class="text-center mono" class:quota-mismatch={spread > 1}>
										{spread}
									</th>
								{/each}
								<th></th>
								<th></th>
								<th></th>
							</tr>
						</tfoot>
					</table>
				</div>
			</div>
			<div class="app-card-foot section-note">
				Les colonnes comptent les jours réels par catégorie principale : un jour férié en week-end
				compte pour un jour férié et un jour de week-end. « Écart cible max » indique l’écart
				maximal entre les jours attribués et la répartition cible compensée (absences et jours
				indisponibles inclus).
			</div>
		</section>
	{/if}
{/if}
