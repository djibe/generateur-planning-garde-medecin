<script lang="ts">
	import { tooltip } from '#lib/actions/tooltip.js';
	import ConfirmModal from '#lib/components/ConfirmModal.svelte';
	import CsvImportModal from '#lib/components/CsvImportModal.svelte';
	import {
		absenceDaysInSemester,
		absenceDaysInYear,
		hasAbsence,
		isAbsentAllYear
	} from '#lib/domain/absence.js';
	import {
		CATEGORIES,
		CATEGORY_LABELS,
		CATEGORY_SHORT,
		capacityByCategory,
		emptyQuota,
		quotaTotal
	} from '#lib/domain/quotas.js';
	import type { Physician, SemesterId, Weekday, WeekdayRank } from '#lib/domain/types.js';
	import {
		MAX_UNAVAILABLE_WEEKDAYS,
		WEEKDAYS,
		WEEKDAY_LABELS,
		WEEKDAY_RANKS
	} from '#lib/domain/weekdays.js';
	import { exportPhysiciansWorkbook } from '#lib/io/excel.js';
	import { app } from '#lib/stores/app.svelte.js';

	let semester = $state<SemesterId>('S1');
	let csvOpen = $state(false);
	let deletingId = $state<string | null>(null);
	let exporting = $state(false);
	let draggingId = $state<string | null>(null);
	let dropTarget = $state<{ id: string; position: 'before' | 'after' } | null>(null);

	const profile = $derived(app.active);
	const physicians = $derived(
		[...(profile?.physicians ?? [])].sort((left, right) => left.sortOrder - right.sortOrder)
	);
	const capacity = $derived(capacityByCategory(app.slots, semester));
	const equitable = $derived(app.equitable[semester]);
	const totalCapacity = $derived(CATEGORIES.reduce((sum, category) => sum + capacity[category], 0));
	const uncovered = $derived(
		CATEGORIES.filter((category) => {
			const total = physicians.reduce(
				(sum, physician) => sum + (equitable.get(physician.id)?.[category] ?? 0),
				0
			);
			return capacity[category] > 0 && total < capacity[category];
		})
	);

	function targetFor(physician: Physician) {
		return equitable.get(physician.id) ?? emptyQuota();
	}

	function weekdayValue(physician: Physician, day: Weekday): string {
		if (physician.unavailableWeekdays?.includes(day)) return 'off';
		const rank = physician.weekdayPreferences?.[day];
		return rank === undefined ? '' : String(rank);
	}

	function onWeekdayChange(physician: Physician, day: Weekday, event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		const raw = select.value;
		let accepted = true;
		if (raw === 'off') accepted = app.setWeekdayStatus(physician.id, day, 'off');
		else if (raw === '') accepted = app.setWeekdayStatus(physician.id, day, null);
		else accepted = app.setWeekdayStatus(physician.id, day, Number(raw) as WeekdayRank);
		if (!accepted) select.value = weekdayValue(physician, day);
	}

	function onAbsenceChange(physician: Physician, field: 'from' | 'to', event: Event) {
		const value = (event.currentTarget as HTMLInputElement).value || null;
		let from = physician.absenceFrom;
		let to = physician.absenceTo;
		if (field === 'from') {
			from = value;
			if (!value) to = null;
			else if (!to) to = value;
		} else {
			to = value;
			if (!value) from = null;
			else if (!from) from = value;
		}
		app.setAbsence(physician.id, from, to);
	}

	function absenceDays(physician: Physician): number {
		if (!profile) return 0;
		return absenceDaysInYear(physician, profile.year);
	}

	function semesterAbsenceDays(physician: Physician): number {
		if (!profile) return 0;
		return absenceDaysInSemester(physician, profile.year, semester);
	}

	function invalidAbsence(physician: Physician): boolean {
		return (
			!!physician.absenceFrom &&
			!!physician.absenceTo &&
			physician.absenceFrom > physician.absenceTo
		);
	}

	async function exportExcel() {
		if (!profile) return;
		exporting = true;
		try {
			await exportPhysiciansWorkbook(profile, app.slots);
			app.notify('success', 'Classeur Excel des médecins généré.');
		} catch (error) {
			console.error(error);
			app.notify('danger', 'Export Excel impossible sur ce navigateur.');
		} finally {
			exporting = false;
		}
	}

	// ---------------------------------------------------------- réordonnancement

	function clearDrag() {
		draggingId = null;
		dropTarget = null;
	}

	function onDragStart(event: DragEvent, physician: Physician) {
		const handle = event.currentTarget as HTMLElement;
		const row = handle.closest('tr');
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', physician.id);
			if (row) event.dataTransfer.setDragImage(row, 24, row.offsetHeight / 2);
		}
		draggingId = physician.id;
	}

	function onDragOver(event: DragEvent, physician: Physician) {
		if (!draggingId || draggingId === physician.id) {
			if (dropTarget) dropTarget = null;
			return;
		}
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		const row = event.currentTarget as HTMLElement;
		const rect = row.getBoundingClientRect();
		const position: 'before' | 'after' =
			event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
		if (dropTarget?.id !== physician.id || dropTarget.position !== position) {
			dropTarget = { id: physician.id, position };
		}
	}

	function onDragLeave(event: DragEvent, physician: Physician) {
		const row = event.currentTarget as HTMLElement;
		const related = event.relatedTarget as Node | null;
		if (related && row.contains(related)) return;
		if (dropTarget?.id === physician.id) dropTarget = null;
	}

	function onDrop(event: DragEvent, physician: Physician) {
		event.preventDefault();
		const source = draggingId;
		const target = dropTarget;
		clearDrag();
		if (!source || !target || target.id !== physician.id) return;
		app.reorderPhysician(source, physician.id, target.position);
	}

	function onHandleKeydown(event: KeyboardEvent, physician: Physician, index: number) {
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		const direction = event.key === 'ArrowUp' ? -1 : 1;
		const neighbour = physicians[index + direction];
		if (!neighbour) return;
		app.reorderPhysician(physician.id, neighbour.id, direction === -1 ? 'before' : 'after');
	}
</script>

{#if !profile}
	<div class="empty-state">
		<div class="icon"><i class="bi bi-people"></i></div>
		<h3>Aucun planning ouvert</h3>
	</div>
{:else}
	<section class="app-card">
		<div class="app-card-head">
			<h2><i class="bi bi-sliders me-2"></i>Paramètres du planning</h2>
			<span class="badge text-bg-light ms-auto">{profile.year}</span>
		</div>
		<div class="app-card-body">
			<div class="row g-3">
				<div class="col-md-4">
					<label class="form-label" for="profile-name">Nom du profil</label>
					<input
						id="profile-name"
						class="form-control"
						value={profile.name}
						oninput={(event) => app.updateProfileMeta({ name: event.currentTarget.value })}
					/>
				</div>
				<div class="col-md-4">
					<label class="form-label" for="profile-area">Secteur</label>
					<input
						id="profile-area"
						class="form-control"
						value={profile.area}
						placeholder="Ex. Secteur Nord"
						oninput={(event) => app.updateProfileMeta({ area: event.currentTarget.value })}
					/>
				</div>
				<div class="col-md-4">
					<span class="form-label d-block">Organisation des week-ends</span>
					<div class="btn-group w-100" role="group" aria-label="Organisation des week-ends">
						<input
							type="radio"
							class="btn-check"
							name="weekend-mode"
							id="weekend-combined"
							checked={profile.settings.weekendMode === 'combined'}
							onchange={() => app.setWeekendMode('combined')}
						/>
						<label class="btn btn-outline-primary btn-sm" for="weekend-combined">
							1 garde (sam. + dim.)
						</label>
						<input
							type="radio"
							class="btn-check"
							name="weekend-mode"
							id="weekend-split"
							checked={profile.settings.weekendMode === 'split'}
							onchange={() => app.setWeekendMode('split')}
						/>
						<label class="btn btn-outline-primary btn-sm" for="weekend-split">2 gardes</label>
					</div>
					<div class="form-text">
						{profile.settings.weekendMode === 'combined'
							? 'Le même médecin couvre le samedi et le dimanche.'
							: 'Samedi et dimanche peuvent être attribués à deux médecins différents.'}
					</div>
				</div>
			</div>
		</div>
	</section>

	<section class="app-card">
		<div class="app-card-head">
			<h2><i class="bi bi-people me-2"></i>Médecins</h2>
			<span class="chip">{physicians.length}</span>
			<div class="ms-auto d-flex flex-wrap gap-2">
				<button
					type="button"
					class="btn btn-sm btn-outline-secondary"
					use:tooltip={'Importer des médecins depuis un fichier CSV'}
					onclick={() => (csvOpen = true)}
				>
					<i class="bi bi-filetype-csv me-1"></i> Importer un CSV
				</button>
				<button
					type="button"
					class="btn btn-sm btn-outline-secondary"
					use:tooltip={'Exporter les médecins et leurs objectifs au format Excel'}
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
				<button
					type="button"
					class="btn btn-sm btn-primary"
					use:tooltip={'Ajouter un médecin'}
					onclick={() => app.addPhysician()}
				>
					<i class="bi bi-plus-lg me-1"></i> Ajouter
				</button>
			</div>
		</div>

		<div class="app-card-body tight">
			{#if !physicians.length}
				<div class="empty-state">
					<div class="icon"><i class="bi bi-person-plus"></i></div>
					<h3>Ajoutez votre premier médecin</h3>
					<p class="mb-2">
						Saisissez les noms et téléphones, ou importez un fichier
						<code>Nom;Téléphone;Jours…</code>.
					</p>
					<div class="d-flex gap-2">
						<button
							type="button"
							class="btn btn-primary btn-sm"
							use:tooltip={'Ajouter un médecin à la liste'}
							onclick={() => app.addPhysician()}
						>
							<i class="bi bi-plus-lg me-1"></i> Ajouter un médecin
						</button>
						<button
							type="button"
							class="btn btn-outline-secondary btn-sm"
							use:tooltip={'Importer des médecins depuis un fichier CSV'}
							onclick={() => (csvOpen = true)}
						>
							Importer un CSV
						</button>
					</div>
				</div>
			{:else}
				<div class="table-responsive">
					<table class="table table-sm align-middle">
						<thead>
							<tr>
								<th style="width: 4.5rem">#</th>
								<th>Nom</th>
								<th>Téléphone</th>
								{#each WEEKDAYS as day (day)}
									<th
										style="width: 5.4rem"
										class="text-center"
										title={`Indisponibilité ou préférence du ${WEEKDAY_LABELS[day].toLowerCase()}`}
									>
										{WEEKDAY_LABELS[day].slice(0, 3)}
									</th>
								{/each}
								<th style="width: 9rem" title="Premier jour d’absence">Exempté du</th>
								<th style="width: 9rem" title="Dernier jour d’absence">au</th>
								<th style="width: 7.5rem" class="text-end">Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each physicians as physician, index (physician.id)}
								<tr
									class:row-absent={isAbsentAllYear(physician, profile.year)}
									class:is-dragging={draggingId === physician.id}
									class:drop-before={dropTarget?.id === physician.id &&
										dropTarget.position === 'before'}
									class:drop-after={dropTarget?.id === physician.id &&
										dropTarget.position === 'after'}
									ondragover={(event) => onDragOver(event, physician)}
									ondragleave={(event) => onDragLeave(event, physician)}
									ondrop={(event) => onDrop(event, physician)}
								>
									<td class="text-nowrap">
										<span
											class="drag-handle"
											draggable="true"
											role="button"
											tabindex="0"
											title="Glisser pour réordonner"
											aria-label={`Réordonner ${physician.name || 'ce médecin'}`}
											ondragstart={(event) => onDragStart(event, physician)}
											ondragend={clearDrag}
											onkeydown={(event) => onHandleKeydown(event, physician, index)}
										>
											<i class="bi bi-grip-vertical"></i>
										</span>
										<span class="text-secondary mono">{index + 1}</span>
									</td>
									<td>
										<input
											class="cell-input"
											value={physician.name}
											placeholder="Dr Nom Prénom"
											aria-label="Nom du médecin"
											oninput={(event) => (physician.name = event.currentTarget.value)}
										/>
										{#if (physician.unavailableWeekdays?.length ?? 0) > MAX_UNAVAILABLE_WEEKDAYS}
											<i
												class="bi bi-exclamation-triangle-fill text-warning ms-1"
												title="Maximum 4 jours indisponibles : rendez au moins un jour disponible."
											></i>
										{/if}
										{#if hasAbsence(physician)}
											<span
												class="badge text-bg-light ms-1"
												title={`${absenceDays(physician)} jour(s) d’absence sur l’année`}
											>
												{absenceDays(physician)} j
											</span>
										{/if}
									</td>
									<td>
										<input
											class="cell-input phone"
											value={physician.phone}
											placeholder="06 00 00 00 00"
											aria-label="Téléphone"
											oninput={(event) => (physician.phone = event.currentTarget.value)}
										/>
									</td>
									{#each WEEKDAYS as day (day)}
										<td class="text-center">
											<select
												class="form-select form-select-sm weekday-select"
												value={weekdayValue(physician, day)}
												aria-label={`${WEEKDAY_LABELS[day]} — ${physician.name || 'sans nom'}`}
												onchange={(event) => onWeekdayChange(physician, day, event)}
											>
												<option value="">—</option>
												<option value="off">Indispo</option>
												{#each WEEKDAY_RANKS as rank (rank)}
													<option value={String(rank)}>{rank}</option>
												{/each}
											</select>
										</td>
									{/each}
									<td>
										<input
											type="date"
											class="form-control form-control-sm"
											class:is-invalid={invalidAbsence(physician)}
											value={physician.absenceFrom ?? ''}
											aria-label={`Absence du — ${physician.name || 'sans nom'}`}
											oninput={(event) => onAbsenceChange(physician, 'from', event)}
										/>
									</td>
									<td>
										<input
											type="date"
											class="form-control form-control-sm"
											class:is-invalid={invalidAbsence(physician)}
											value={physician.absenceTo ?? ''}
											aria-label={`Absence au — ${physician.name || 'sans nom'}`}
											oninput={(event) => onAbsenceChange(physician, 'to', event)}
										/>
									</td>
									<td class="text-end text-nowrap">
										{#if hasAbsence(physician)}
											<button
												type="button"
												class="btn btn-sm btn-outline-secondary"
												aria-label="Effacer l’absence"
												use:tooltip={'Effacer l’absence'}
												onclick={() => app.clearAbsence(physician.id)}
											>
												<i class="bi bi-calendar-x"></i>
											</button>
										{/if}
										<button
											type="button"
											class="btn btn-sm btn-outline-danger ms-1"
											aria-label="Supprimer ce médecin"
											use:tooltip={'Supprimer ce médecin'}
											onclick={() => (deletingId = physician.id)}
										>
											<i class="bi bi-trash3"></i>
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<div class="app-card-foot small text-secondary">
					Chaque jour : <strong>—</strong> disponible sans préférence, <strong>Indispo</strong>
					jamais ce jour (maximum 4 jours), <strong>1</strong> jour préféré … <strong>5</strong>
					moins préféré. <strong>Exempté du / au</strong> : période d’absence unique, vide si le médecin
					est disponible toute l’année.
				</div>
			{/if}
		</div>
	</section>

	{#if physicians.length}
		<section class="app-card">
			<div class="app-card-head">
				<h2><i class="bi bi-bullseye me-2"></i>Répartition équitable par semestre</h2>
				<div class="ms-auto d-flex flex-wrap align-items-center gap-2">
					<div class="btn-group btn-group-sm" role="group" aria-label="Semestre">
						<button
							type="button"
							class="btn btn-outline-primary"
							class:active={semester === 'S1'}
							onclick={() => (semester = 'S1')}
							use:tooltip={'Afficher la répartition du premier semestre'}
						>
							Semestre 1
						</button>
						<button
							type="button"
							class="btn btn-outline-primary"
							class:active={semester === 'S2'}
							onclick={() => (semester = 'S2')}
							use:tooltip={'Afficher la répartition du second semestre'}
						>
							Semestre 2
						</button>
					</div>
				</div>
			</div>

			<div class="app-card-body tight">
				<div class="table-responsive">
					<table class="table table-sm align-middle quota-table">
						<thead>
							<tr>
								<th>Médecin</th>
								<th class="text-center" title="Jours d’absence pris en compte dans le prorata"
									>Absence</th
								>
								{#each CATEGORIES as category (category)}
									<th class="text-center" title={CATEGORY_LABELS[category]}
										>{CATEGORY_SHORT[category]}</th
									>
								{/each}
								<th class="text-center">Jours dus</th>
							</tr>
						</thead>
						<tbody>
							{#each physicians as physician (physician.id)}
								{@const target = targetFor(physician)}
								<tr class:row-absent={isAbsentAllYear(physician, profile.year)}>
									<td class="text-nowrap">
										{physician.name || 'Sans nom'}
										{#if isAbsentAllYear(physician, profile.year)}
											<span class="badge text-bg-secondary ms-1">absent</span>
										{/if}
									</td>
									<td class="text-center mono small" title="Jours d’absence sur le semestre">
										{semesterAbsenceDays(physician)}
									</td>
									{#each CATEGORIES as category (category)}
										<td class="text-center mono">{target[category]}</td>
									{/each}
									<td class="text-center fw-semibold mono">{quotaTotal(target)}</td>
								</tr>
							{/each}
						</tbody>
						<tfoot>
							<tr>
								<th>Jours disponibles</th>
								<td></td>
								{#each CATEGORIES as category (category)}
									<td class="text-center mono">{capacity[category]}</td>
								{/each}
								<td class="text-center mono fw-semibold">{totalCapacity}</td>
							</tr>
						</tfoot>
					</table>
				</div>
			</div>
			{#if uncovered.length}
				<div class="app-card-body pt-0">
					<p class="section-note text-warning-emphasis mb-0">
						Aucun médecin éligible pour : {uncovered
							.map((category) => CATEGORY_LABELS[category])
							.join(', ')}. Ces créneaux resteront non pourvus.
					</p>
				</div>
			{/if}
			<div class="app-card-foot small text-secondary">
				La répartition est calculée automatiquement : chaque catégorie est partagée aussi
				équitablement que possible entre les médecins éligibles, au prorata de leurs absences. Le
				générateur privilégie cet équilibre, puis l’espacement, puis les jours préférés. Un jour
				férié en week-end compte pour un jour férié et un jour de week-end.
			</div>
		</section>
	{/if}
{/if}

{#if csvOpen}
	<CsvImportModal onclose={() => (csvOpen = false)} />
{/if}

{#if deletingId}
	{@const target = physicians.find((physician) => physician.id === deletingId)}
	<ConfirmModal
		title="Supprimer le médecin"
		message={`${target?.name || 'Ce médecin'} sera retiré de la liste et toutes ses gardes seront libérées.`}
		confirmLabel="Supprimer"
		danger
		onconfirm={() => app.removePhysician(deletingId ?? '')}
		onclose={() => (deletingId = null)}
	/>
{/if}
