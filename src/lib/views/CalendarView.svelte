<script lang="ts">
	import SwapModal from '#lib/components/SwapModal.svelte';
	import TypeBadge from '#lib/components/TypeBadge.svelte';
	import YearCalendar from '#lib/components/YearCalendar.svelte';
	import { CATEGORIES } from '#lib/domain/quotas.js';
	import { isAvailable } from '#lib/domain/generator.js';
	import type { SemesterId, Slot } from '#lib/domain/types.js';
	import { exportPlanningWorkbook } from '#lib/io/excel.js';
	import { app } from '#lib/stores/app.svelte.js';
	import { formatLong, formatMedium } from '#lib/utils/date.js';

	let mode = $state<'calendar' | 'list'>('calendar');
	let semester = $state<SemesterId>('S1');
	let swapSlotId = $state<string | null>(null);
	let exporting = $state(false);

	const profile = $derived(app.active);
	const physicians = $derived(
		[...(profile?.physicians ?? [])].sort((left, right) => left.sortOrder - right.sortOrder)
	);
	const slots = $derived(
		app.slotsBySemester[semester]
			.slice()
			.sort((left, right) => left.start.localeCompare(right.start))
	);
	const swapCount = $derived(slots.filter((slot) => app.assignmentOf(slot)).length);
	const conflictIds = $derived.by(() => {
		const conflicts = new Set<string>();
		for (const slot of slots) {
			const physicianId = app.assignmentOf(slot);
			if (!physicianId) continue;
			const physician = app.physicianMap.get(physicianId);
			if (physician && !isAvailable(physician, slot)) conflicts.add(slot.id);
		}
		return conflicts;
	});

	function onAssign(slot: Slot, event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		const physicianId = select.value;
		if (!physicianId) return;
		app.swapWithNearest(slot.id, physicianId);
		// If the swap was refused (unavailable physician, unknown slot), re-sync the select.
		queueMicrotask(() => {
			select.value = app.assignmentOf(slot) ?? '';
		});
	}

	function label(slot: Slot): string | null {
		const physicianId = app.assignmentOf(slot);
		if (!physicianId) return 'Non attribué';
		return app.shortName(physicianId);
	}

	function togglePin(slot: Slot) {
		if (profile?.pins[slot.id]) app.unpin(slot.id);
		else app.pin(slot.id);
	}

	async function exportExcel() {
		if (!profile) return;
		exporting = true;
		try {
			await exportPlanningWorkbook(profile, app.slots);
			app.notify('success', 'Planning exporté en Excel.');
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
		<div class="icon"><i class="bi bi-calendar3"></i></div>
		<h3>Aucun planning ouvert</h3>
	</div>
{:else}
	<div class="d-flex flex-wrap align-items-center gap-2 mb-3 no-print">
		<div>
			<h1 class="h4 mb-0">Calendrier des gardes</h1>
			<p class="section-note mb-0">
				{swapCount}/{slots.length} créneaux pourvus au semestre {semester === 'S1' ? '1' : '2'}.
			</p>
		</div>
		<div class="ms-auto d-flex flex-wrap gap-2 align-items-center">
			<div class="btn-group btn-group-sm" role="group" aria-label="Semestre">
				<button
					type="button"
					class="btn btn-outline-primary"
					class:active={semester === 'S1'}
					onclick={() => (semester = 'S1')}
				>
					S1
				</button>
				<button
					type="button"
					class="btn btn-outline-primary"
					class:active={semester === 'S2'}
					onclick={() => (semester = 'S2')}
				>
					S2
				</button>
			</div>
			<div class="btn-group btn-group-sm" role="group" aria-label="Affichage">
				<button
					type="button"
					class="btn btn-outline-secondary"
					class:active={mode === 'calendar'}
					onclick={() => (mode = 'calendar')}
					title="Vue calendrier"
				>
					<i class="bi bi-grid-3x3-gap me-1"></i> Calendrier
				</button>
				<button
					type="button"
					class="btn btn-outline-secondary"
					class:active={mode === 'list'}
					onclick={() => (mode = 'list')}
					title="Vue liste"
				>
					<i class="bi bi-list-ul me-1"></i> Liste
				</button>
			</div>
			<button type="button" class="btn btn-sm btn-outline-secondary" onclick={() => window.print()}>
				<i class="bi bi-printer me-1"></i> Imprimer
			</button>
			<button
				type="button"
				class="btn btn-sm btn-outline-secondary"
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

	<div class="d-flex flex-wrap align-items-center gap-3 mb-3">
		<div class="legend">
			{#each CATEGORIES as category (category)}
				<TypeBadge type={category} />
			{/each}
			<TypeBadge type="saturday" weekend />
		</div>
		<span class="section-note ms-auto no-print">
			Cliquez sur une garde pour l’échanger. Le cadenas la protège lors de la prochaine génération.
		</span>
	</div>

	{#if conflictIds.size}
		<div class="alert alert-warning d-flex align-items-center gap-2 py-2 small">
			<i class="bi bi-exclamation-triangle-fill"></i>
			<span>
				{conflictIds.size} garde(s) attribuée(s) à un médecin désormais indisponible. Elles sont surlignées
				: régénérez le planning ou échangez-les.
			</span>
		</div>
	{/if}

	{#if mode === 'calendar'}
		<YearCalendar
			year={profile.year}
			{slots}
			{label}
			onSlotClick={(slot) => (swapSlotId = slot.id)}
			highlightId={null}
			{conflictIds}
			monthFrom={semester === 'S1' ? 0 : 6}
			monthTo={semester === 'S1' ? 5 : 11}
		/>
	{:else}
		<section class="app-card">
			<div class="app-card-body tight">
				<div class="table-responsive planning-list">
					<table class="table table-sm align-middle">
						<thead>
							<tr>
								<th>Date</th>
								<th>Type</th>
								<th>Jour férié</th>
								<th style="min-width: 15rem">Médecin</th>
								<th class="text-center" style="width: 5rem">Verrou</th>
								<th class="text-center" style="width: 5rem">Échange</th>
							</tr>
						</thead>
						<tbody>
							{#each slots as slot (slot.id)}
								{@const assignment = app.assignmentOf(slot)}
								{@const pinned = !!profile.pins[slot.id]}
								<tr class:row-conflict={conflictIds.has(slot.id)}>
									<td class="text-nowrap">
										<div class="fw-medium">{formatMedium(slot.start)}</div>
										{#if slot.isWeekendBlock}
											<div class="small text-secondary">→ {formatMedium(slot.end)}</div>
										{/if}
									</td>
									<td><TypeBadge type={slot.type} weekend={slot.isWeekendBlock} /></td>
									<td class="small text-secondary">{slot.holidayName ?? '—'}</td>
									<td>
										{#if conflictIds.has(slot.id)}
											<i
												class="bi bi-exclamation-triangle-fill text-warning me-1"
												title="Ce médecin est désormais indisponible à cette date"
											></i>
										{/if}
										<select
											class="form-select form-select-sm"
											value={assignment ?? ''}
											aria-label={`Médecin du ${formatLong(slot.start)}`}
											onchange={(event) => onAssign(slot, event)}
										>
											<option value="">— Non attribué —</option>
											{#each physicians as physician (physician.id)}
												<option value={physician.id}>{physician.name || 'Sans nom'}</option>
											{/each}
										</select>
									</td>
									<td class="text-center">
										<button
											type="button"
											class="btn btn-sm {pinned ? 'btn-primary' : 'btn-outline-secondary'}"
											title={pinned ? 'Déverrouiller cette garde' : 'Verrouiller cette garde'}
											onclick={() => togglePin(slot)}
										>
											<i class="bi {pinned ? 'bi-lock-fill' : 'bi-unlock'}"></i>
										</button>
									</td>
									<td class="text-center">
										<button
											type="button"
											class="btn btn-sm btn-outline-secondary"
											title="Choisir un autre médecin à échanger"
											onclick={() => (swapSlotId = slot.id)}
										>
											<i class="bi bi-arrow-left-right"></i>
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		</section>
	{/if}
{/if}

{#if swapSlotId}
	<SwapModal slotId={swapSlotId} onclose={() => (swapSlotId = null)} />
{/if}
