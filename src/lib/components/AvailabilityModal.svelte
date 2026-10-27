<script lang="ts">
	import { app } from '$lib/stores/app.svelte';
	import Modal from './Modal.svelte';

	let { physicianId, onclose }: { physicianId: string; onclose: () => void } = $props();

	const physician = $derived(app.physicianMap.get(physicianId));

	function setDate(target: 'from' | 'to', value: string) {
		if (!physician) return;
		const next = value || null;
		if (target === 'from') physician.exemptFrom = next;
		else physician.exemptTo = next;
	}

	function setRangeDate(rangeId: string, key: 'from' | 'to', value: string) {
		if (!physician) return;
		const range = physician.unavailability.find((item) => item.id === rangeId);
		if (range) range[key] = value;
	}

	const invalidRanges = $derived(
		(physician?.unavailability ?? []).filter((range) => range.from > range.to)
	);
</script>

<Modal title="Disponibilités" {onclose}>
	{#if !physician}
		<p class="mb-0">Ce médecin n’existe plus.</p>
	{:else}
		<div class="d-grid gap-4">
			<section>
				<div class="form-check form-switch">
					<input
						class="form-check-input"
						type="checkbox"
						id="exempt"
						bind:checked={physician.exempt}
					/>
					<label class="form-check-label fw-semibold" for="exempt">Exempté de garde</label>
				</div>

				{#if physician.exempt}
					<div class="row g-2 mt-2">
						<div class="col-sm-6">
							<label class="form-label small" for="exempt-from">Du (optionnel)</label>
							<input
								id="exempt-from"
								type="date"
								class="form-control"
								value={physician.exemptFrom ?? ''}
								oninput={(event) => setDate('from', event.currentTarget.value)}
							/>
						</div>
						<div class="col-sm-6">
							<label class="form-label small" for="exempt-to">Au (optionnel)</label>
							<input
								id="exempt-to"
								type="date"
								class="form-control"
								value={physician.exemptTo ?? ''}
								oninput={(event) => setDate('to', event.currentTarget.value)}
							/>
						</div>
						<div class="col-12">
							<div class="form-text mb-0">
								Laissez les deux dates vides pour une exemption sur toute l’année. Sinon, le médecin
								est exclu uniquement sur la période indiquée.
							</div>
						</div>
					</div>
				{/if}
			</section>

			<section>
				<div class="d-flex align-items-center justify-content-between mb-2">
					<div>
						<h3 class="h6 mb-0">Absences ponctuelles</h3>
						<div class="form-text mt-0">Congés, formations, obligations personnelles…</div>
					</div>
					<button
						type="button"
						class="btn btn-sm btn-outline-primary"
						onclick={() => app.addUnavailability(physician.id)}
					>
						<i class="bi bi-plus-lg me-1"></i> Ajouter
					</button>
				</div>

				{#if !physician.unavailability.length}
					<div class="border rounded-3 p-3 text-secondary small">
						Aucune absence déclarée. Ce médecin peut être affecté à n’importe quelle date.
					</div>
				{:else}
					<div class="d-grid gap-2">
						{#each physician.unavailability as range (range.id)}
							<div class="row g-2 align-items-end border rounded-3 p-2">
								<div class="col-sm-4">
									<label class="form-label small mb-1" for={`from-${range.id}`}>Du</label>
									<input
										id={`from-${range.id}`}
										type="date"
										class="form-control form-control-sm"
										class:is-invalid={range.from > range.to}
										value={range.from}
										oninput={(event) => setRangeDate(range.id, 'from', event.currentTarget.value)}
									/>
								</div>
								<div class="col-sm-4">
									<label class="form-label small mb-1" for={`to-${range.id}`}>Au</label>
									<input
										id={`to-${range.id}`}
										type="date"
										class="form-control form-control-sm"
										class:is-invalid={range.from > range.to}
										value={range.to}
										oninput={(event) => setRangeDate(range.id, 'to', event.currentTarget.value)}
									/>
								</div>
								<div class="col-sm-3">
									<label class="form-label small mb-1" for={`reason-${range.id}`}>Motif</label>
									<input
										id={`reason-${range.id}`}
										class="form-control form-control-sm"
										placeholder="Optionnel"
										value={range.reason}
										oninput={(event) => {
											const target = physician.unavailability.find((item) => item.id === range.id);
											if (target) target.reason = event.currentTarget.value;
										}}
									/>
								</div>
								<div class="col-sm-1 text-end">
									<button
										type="button"
										class="btn btn-sm btn-outline-danger"
										title="Supprimer cette absence"
										onclick={() => app.removeUnavailability(physician.id, range.id)}
									>
										<i class="bi bi-trash3"></i>
									</button>
								</div>
							</div>
						{/each}
					</div>
					{#if invalidRanges.length}
						<div class="alert alert-warning mt-2 mb-0 py-2 small">
							Certaines périodes ont une date de fin antérieure à la date de début : elles ne seront
							pas appliquées.
						</div>
					{/if}
				{/if}
			</section>
		</div>
	{/if}

	{#snippet footer()}
		<button type="button" class="btn btn-primary" onclick={onclose}>Terminé</button>
	{/snippet}
</Modal>
