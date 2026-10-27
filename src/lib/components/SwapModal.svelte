<script lang="ts">
	import { slotLabel } from '$lib/domain/calendar';
	import { app } from '$lib/stores/app.svelte';
	import { diffDays } from '$lib/utils/date';
	import Modal from './Modal.svelte';
	import TypeBadge from './TypeBadge.svelte';

	let { slotId, onclose }: { slotId: string; onclose: () => void } = $props();

	let query = $state('');
	let selectedId = $state<string | null>(null);

	const slot = $derived(app.slots.find((entry) => entry.id === slotId));
	const currentId = $derived(slot ? app.assignmentOf(slot) : null);
	const currentName = $derived(app.physicianName(currentId));

	const candidates = $derived.by(() => {
		if (!slot) return [];
		const needle = query.trim().toLowerCase();
		return app.slots
			.filter((entry) => entry.id !== slot.id)
			.map((entry) => {
				const physicianId = app.assignmentOf(entry);
				return {
					slot: entry,
					physicianId,
					name: app.physicianName(physicianId),
					distance: Math.abs(diffDays(slot.start, entry.start))
				};
			})
			.filter((entry) => entry.physicianId && entry.physicianId !== currentId)
			.filter((entry) => !needle || entry.name.toLowerCase().includes(needle))
			.sort((left, right) => left.distance - right.distance)
			.slice(0, 100);
	});

	function confirm() {
		if (!slot || !selectedId) return;
		app.swapSlots(slot.id, selectedId);
		onclose();
	}
</script>

<Modal title="Échanger une garde" {onclose} size="lg">
	{#if !slot}
		<p class="mb-0">Ce créneau n’existe plus.</p>
	{:else}
		<div class="d-grid gap-3">
			<div class="alert alert-secondary d-flex flex-wrap align-items-center gap-3 mb-0">
				<TypeBadge type={slot.type} weekend={slot.isWeekendBlock} />
				<div>
					<div class="fw-semibold">{slotLabel(slot)}</div>
					<div class="small text-secondary">
						Actuellement : <strong>{currentName}</strong>
						{#if slot.holidayName}· {slot.holidayName}{/if}
					</div>
				</div>
			</div>

			<div>
				<label class="form-label" for="swap-query">Rechercher un médecin ou une date</label>
				<input
					id="swap-query"
					class="form-control"
					bind:value={query}
					placeholder="Nom du médecin…"
				/>
			</div>

			<div>
				<div class="d-flex justify-content-between align-items-center mb-2">
					<span class="eyebrow">Gardes échangeables (les plus proches d’abord)</span>
					<span class="chip">{candidates.length}</span>
				</div>

				{#if !candidates.length}
					<div class="border rounded-3 p-3 text-secondary small">
						Aucune autre garde à échanger. Ajoutez d’autres médecins ou générez le planning.
					</div>
				{:else}
					<div class="swap-list">
						{#each candidates as candidate (candidate.slot.id)}
							<button
								type="button"
								class="swap-row"
								class:selected={selectedId === candidate.slot.id}
								onclick={() => (selectedId = candidate.slot.id)}
							>
								<TypeBadge type={candidate.slot.type} weekend={candidate.slot.isWeekendBlock} />
								<span class="who">{candidate.name}</span>
								<span class="when">{slotLabel(candidate.slot)}</span>
								<span class="when ms-auto">{candidate.distance} j</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}

	{#snippet footer()}
		<button type="button" class="btn btn-outline-secondary" onclick={onclose}>Annuler</button>
		<button type="button" class="btn btn-primary" onclick={confirm} disabled={!selectedId}>
			<i class="bi bi-arrow-left-right me-1"></i> Échanger
		</button>
	{/snippet}
</Modal>
