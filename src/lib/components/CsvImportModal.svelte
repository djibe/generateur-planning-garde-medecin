<script lang="ts">
	import { parseCsv } from '#lib/io/csv.js';
	import { WEEKDAY_LABELS, WEEKDAYS } from '#lib/domain/weekdays.js';
	import type { Weekday, WeekdayRank } from '#lib/domain/types.js';
	import { app } from '#lib/stores/app.svelte.js';
	import Modal from './Modal.svelte';

	let { onclose }: { onclose: () => void } = $props();

	let text = $state('');
	let mode = $state<'append' | 'replace'>('append');
	let fileName = $state('');
	let error = $state<string | null>(null);

	const rows = $derived(parseCsv(text));
	const invalidCount = $derived(
		rows.reduce(
			(total, row) =>
				total +
				row.invalidWeekdays.length +
				row.invalidPreferences.length +
				row.invalidAbsence.length,
			0
		)
	);

	function weekdayLabel(value: string): string {
		return WEEKDAY_LABELS[value as Weekday] ?? value;
	}

	function preferenceLabel(preferences: Partial<Record<Weekday, WeekdayRank>>): string {
		return WEEKDAYS.filter((day) => preferences[day] !== undefined)
			.sort((left, right) => (preferences[left] ?? 0) - (preferences[right] ?? 0))
			.map((day) => `${WEEKDAY_LABELS[day].slice(0, 3)} (${preferences[day]})`)
			.join(', ');
	}

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
				Format attendu :
				<code>Nom;Téléphone;Absence du;Absence au;Jours indisponibles;Jours préférés</code> — une
				ligne par médecin. Seule la première colonne est obligatoire. Le séparateur <code>;</code>,
				<code>,</code> ou tabulation est détecté automatiquement. Dates au format
				<code>AAAA-MM-JJ</code>. Jours indisponibles : <code>lun</code> à <code>ven</code> (max 4).
				Préférences : <code>lun=1,mer=3</code> (1 = jour préféré). Les jours fériés restent disponibles.
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
				placeholder={'Dr Alice Martin;06 12 34 56 78;2026-03-01;2026-03-31;lun,mer;mar=1,jeu=2\nDr Benoit Petit;06 98 76 54 32;;;;ven=1'}
			></textarea>
		</div>

		{#if error}
			<div class="alert alert-danger mb-0 py-2 small">{error}</div>
		{/if}

		{#if invalidCount}
			<div class="alert alert-warning mb-0 py-2 small">
				<i class="bi bi-exclamation-triangle me-1"></i>
				{invalidCount} valeur(s) ignorée(s). Dates : <code>AAAA-MM-JJ</code>, fin après début. Jours
				: <code>lun</code> à <code>ven</code> (max 4 indisponibles) ; préférences :
				<code>lun=1</code> à <code>ven=5</code>, rangs uniques, uniquement sur un jour disponible.
			</div>
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
								<th>Absence du</th>
								<th>Absence au</th>
								<th>Jours indisponibles</th>
								<th>Jours préférés</th>
							</tr>
						</thead>
						<tbody>
							{#each rows.slice(0, 8) as row, index (index)}
								<tr>
									<td>{row.name}</td>
									<td class="mono">{row.phone || '—'}</td>
									<td class="small mono">
										{row.absenceFrom ?? '—'}
										{#if row.invalidAbsence.length}
											<span
												class="badge text-bg-warning ms-1"
												title={`Dates ignorées : ${row.invalidAbsence.join(', ')}`}
											>
												{row.invalidAbsence.length} ignorée(s)
											</span>
										{/if}
									</td>
									<td class="small mono">{row.absenceTo ?? '—'}</td>
									<td class="small">
										{row.unavailableWeekdays.length
											? row.unavailableWeekdays.map(weekdayLabel).join(', ')
											: '—'}
										{#if row.invalidWeekdays.length}
											<span
												class="badge text-bg-warning ms-1"
												title={`Valeurs ignorées : ${row.invalidWeekdays.join(', ')}`}
											>
												{row.invalidWeekdays.length} ignorée(s)
											</span>
										{/if}
									</td>
									<td class="small">
										{Object.keys(row.weekdayPreferences).length
											? preferenceLabel(row.weekdayPreferences)
											: '—'}
										{#if row.invalidPreferences.length}
											<span
												class="badge text-bg-warning ms-1"
												title={`Valeurs ignorées : ${row.invalidPreferences.join(', ')}`}
											>
												{row.invalidPreferences.length} ignorée(s)
											</span>
										{/if}
									</td>
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
