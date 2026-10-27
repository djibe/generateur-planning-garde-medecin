<script lang="ts">
	import { parseCsv } from '#lib/io/csv.js';
	import { app } from '#lib/stores/app.svelte.js';
	import Modal from './Modal.svelte';

	let { onclose }: { onclose: () => void } = $props();

	let text = $state('');
	let mode = $state<'append' | 'replace'>('append');
	let fileName = $state('');
	let error = $state<string | null>(null);

	const rows = $derived(parseCsv(text));

	async function onFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		fileName = file.name;
		try {
			text = await file.text();
			error = null;
		} catch {
			error = 'Impossible de lire ce fichier.';
		}
	}

	function submit() {
		if (!rows.length) return;
		app.importPhysicians(rows, mode);
		onclose();
	}
</script>

<Modal title="Importer des médecins (CSV)" {onclose}>
	<div class="d-grid gap-3">
		<div class="alert alert-info d-flex gap-2 mb-0 small">
			<i class="bi bi-info-circle-fill"></i>
			<div>
				Format attendu : <code>Nom;Téléphone;Exempté</code> — une ligne par médecin. Les colonnes
				<code>Téléphone</code> et <code>Exempté</code> sont optionnelles. Le séparateur
				<code>;</code>, <code>,</code> ou tabulation est détecté automatiquement.
			</div>
		</div>

		<div class="row g-3">
			<div class="col-md-6">
				<label class="form-label" for="csv-file">Fichier CSV</label>
				<input
					id="csv-file"
					type="file"
					class="form-control"
					accept=".csv,text/csv,text/plain"
					onchange={onFile}
				/>
				{#if fileName}<div class="form-text">Fichier : {fileName}</div>{/if}
			</div>
			<div class="col-md-6">
				<span class="form-label d-block">Mode d’import</span>
				<div class="d-flex gap-3">
					<div class="form-check">
						<input
							class="form-check-input"
							type="radio"
							id="csv-append"
							bind:group={mode}
							value="append"
						/>
						<label class="form-check-label" for="csv-append">Ajouter</label>
					</div>
					<div class="form-check">
						<input
							class="form-check-input"
							type="radio"
							id="csv-replace"
							bind:group={mode}
							value="replace"
						/>
						<label class="form-check-label" for="csv-replace">Remplacer la liste</label>
					</div>
				</div>
			</div>
		</div>

		<div>
			<label class="form-label" for="csv-text">Ou collez les lignes</label>
			<textarea
				id="csv-text"
				class="form-control font-monospace"
				rows="5"
				bind:value={text}
				placeholder={'Dr Alice Martin;06 12 34 56 78;non\nDr Benoit Petit;06 98 76 54 32;oui'}
			></textarea>
		</div>

		{#if error}
			<div class="alert alert-danger mb-0 py-2 small">{error}</div>
		{/if}

		{#if rows.length}
			<div>
				<div class="d-flex align-items-center justify-content-between mb-2">
					<span class="eyebrow">Aperçu</span>
					<span class="chip">{rows.length} médecin(s)</span>
				</div>
				<div class="table-responsive border rounded-3">
					<table class="table table-sm mb-0">
						<thead>
							<tr>
								<th>Nom</th>
								<th>Téléphone</th>
								<th>Exempté</th>
							</tr>
						</thead>
						<tbody>
							{#each rows.slice(0, 8) as row, index (index)}
								<tr>
									<td>{row.name}</td>
									<td class="mono">{row.phone || '—'}</td>
									<td>{row.exempt ? 'oui' : 'non'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#if rows.length > 8}
					<div class="form-text">… et {rows.length - 8} autre(s) ligne(s).</div>
				{/if}
			</div>
		{/if}
	</div>

	{#snippet footer()}
		<button type="button" class="btn btn-outline-secondary" onclick={onclose}>Annuler</button>
		<button type="button" class="btn btn-primary" onclick={submit} disabled={!rows.length}>
			<i class="bi bi-box-arrow-in-down me-1"></i>
			Importer {rows.length ? `(${rows.length})` : ''}
		</button>
	{/snippet}
</Modal>
