<script lang="ts">
	import AvailabilityModal from '#lib/components/AvailabilityModal.svelte';
	import ConfirmModal from '#lib/components/ConfirmModal.svelte';
	import CsvImportModal from '#lib/components/CsvImportModal.svelte';
	import {
		CATEGORIES,
		CATEGORY_LABELS,
		CATEGORY_SHORT,
		capacityByCategory,
		emptyQuota,
		isFullyExempt,
		quotaTotal,
		targetsByCategory
	} from '#lib/domain/quotas.js';
	import type { Category, Physician, SemesterId, Weekday, WeekdayRank } from '#lib/domain/types.js';
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
	let availabilityId = $state<string | null>(null);
	let deletingId = $state<string | null>(null);
	let exporting = $state(false);

	const profile = $derived(app.active);
	const physicians = $derived(profile?.physicians ?? []);
	const capacity = $derived(capacityByCategory(app.slots, semester));
	const targets = $derived(
		profile ? targetsByCategory(profile.physicians, semester) : emptyQuota()
	);
	const mismatches = $derived(app.mismatches.filter((entry) => entry.semester === semester));
	const mismatchCategories = $derived(new Set(mismatches.map((entry) => entry.category)));
	const totalTarget = $derived(CATEGORIES.reduce((sum, category) => sum + targets[category], 0));
	const totalCapacity = $derived(CATEGORIES.reduce((sum, category) => sum + capacity[category], 0));

	function onTargetInput(physician: Physician, category: Category, event: Event) {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		app.setTarget(semester, physician.id, category, value);
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
					onclick={() => (csvOpen = true)}
				>
					<i class="bi bi-filetype-csv me-1"></i> Importer un CSV
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
				<button type="button" class="btn btn-sm btn-primary" onclick={() => app.addPhysician()}>
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
						<button type="button" class="btn btn-primary btn-sm" onclick={() => app.addPhysician()}>
							<i class="bi bi-plus-lg me-1"></i> Ajouter un médecin
						</button>
						<button
							type="button"
							class="btn btn-outline-secondary btn-sm"
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
								<th style="width: 6rem">Exempté</th>
								{#each WEEKDAYS as day (day)}
									<th
										style="width: 5.4rem"
										class="text-center"
										title={`Indisponibilité ou préférence du ${WEEKDAY_LABELS[day].toLowerCase()}`}
									>
										{WEEKDAY_LABELS[day].slice(0, 3)}
									</th>
								{/each}
								<th style="width: 7.5rem" class="text-end">Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each physicians as physician, index (physician.id)}
								<tr class:row-exempt={isFullyExempt(physician)}>
									<td class="text-nowrap">
										<span class="text-secondary mono me-1">{index + 1}</span>
										<button
											type="button"
											class="btn btn-sm btn-icon"
											title="Monter"
											disabled={index === 0}
											onclick={() => app.movePhysician(physician.id, -1)}
										>
											<i class="bi bi-chevron-up"></i>
										</button>
										<button
											type="button"
											class="btn btn-sm btn-icon"
											title="Descendre"
											disabled={index === physicians.length - 1}
											onclick={() => app.movePhysician(physician.id, 1)}
										>
											<i class="bi bi-chevron-down"></i>
										</button>
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
									<td>
										<div class="form-check form-switch mb-0">
											<input
												class="form-check-input"
												type="checkbox"
												id={`exempt-${physician.id}`}
												bind:checked={physician.exempt}
												aria-label="Médecin exempté"
											/>
											<label class="form-check-label small" for={`exempt-${physician.id}`}>
												{physician.exempt ? 'Oui' : 'Non'}
											</label>
										</div>
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
									<td class="text-end text-nowrap">
										<button
											type="button"
											class="btn btn-sm btn-outline-secondary"
											title="Disponibilités et absences"
											onclick={() => (availabilityId = physician.id)}
										>
											<i class="bi bi-calendar-x"></i>
										</button>
										<button
											type="button"
											class="btn btn-sm btn-outline-danger ms-1"
											title="Supprimer ce médecin"
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
				<div class="form-text px-1">
					Chaque jour : <strong>—</strong> disponible sans préférence, <strong>Indispo</strong>
					jamais ce jour (maximum 4 jours), <strong>1</strong> jour préféré … <strong>5</strong> moins
					préféré. Les jours fériés restent disponibles.
				</div>
			{/if}
		</div>
	</section>

	{#if physicians.length}
		<section class="app-card">
			<div class="app-card-head">
				<h2><i class="bi bi-bullseye me-2"></i>Objectifs de garde par semestre</h2>
				<div class="ms-auto d-flex flex-wrap align-items-center gap-2">
					<div class="btn-group btn-group-sm" role="group" aria-label="Semestre">
						<button
							type="button"
							class="btn btn-outline-primary"
							class:active={semester === 'S1'}
							onclick={() => (semester = 'S1')}
						>
							Semestre 1
						</button>
						<button
							type="button"
							class="btn btn-outline-primary"
							class:active={semester === 'S2'}
							onclick={() => (semester = 'S2')}
						>
							Semestre 2
						</button>
					</div>
					<button
						type="button"
						class="btn btn-sm btn-outline-secondary"
						title="Répartir équitablement entre les médecins disponibles"
						onclick={() => app.applyAverageTargets(semester)}
					>
						<i class="bi bi-magic me-1"></i> Répartition équitable
					</button>
					<button
						type="button"
						class="btn btn-sm btn-outline-secondary"
						title="Ajuster les objectifs actuels au nombre de créneaux"
						onclick={() => app.adjustTargetsToCapacity(semester)}
					>
						<i class="bi bi-rulers me-1"></i> Ajuster aux créneaux
					</button>
				</div>
			</div>

			<div class="app-card-body tight">
				<div class="table-responsive">
					<table class="table table-sm align-middle quota-table">
						<thead>
							<tr>
								<th>Médecin</th>
								{#each CATEGORIES as category (category)}
									<th class="text-center" title={CATEGORY_LABELS[category]}
										>{CATEGORY_SHORT[category]}</th
									>
								{/each}
								<th class="text-center">Total</th>
							</tr>
						</thead>
						<tbody>
							{#each physicians as physician (physician.id)}
								<tr class:row-exempt={isFullyExempt(physician)}>
									<td class="text-nowrap">
										{physician.name || 'Sans nom'}
										{#if isFullyExempt(physician)}
											<span class="badge text-bg-secondary ms-1">exempté</span>
										{/if}
									</td>
									{#each CATEGORIES as category (category)}
										<td class="text-center">
											<input
												type="number"
												min="0"
												max="400"
												class="form-control form-control-sm quota-input"
												value={physician.targets[semester][category]}
												aria-label={`${CATEGORY_LABELS[category]} — ${physician.name || 'sans nom'}`}
												oninput={(event) => onTargetInput(physician, category, event)}
											/>
										</td>
									{/each}
									<td class="text-center fw-semibold mono"
										>{quotaTotal(physician.targets[semester])}</td
									>
								</tr>
							{/each}
						</tbody>
						<tfoot>
							<tr>
								<th>Objectifs</th>
								{#each CATEGORIES as category (category)}
									<td
										class="text-center mono"
										class:quota-mismatch={mismatchCategories.has(category)}
									>
										{targets[category]}
									</td>
								{/each}
								<td class="text-center mono fw-semibold">{totalTarget}</td>
							</tr>
							<tr>
								<th>Jours disponibles</th>
								{#each CATEGORIES as category (category)}
									<td class="text-center mono">{capacity[category]}</td>
								{/each}
								<td class="text-center mono fw-semibold">{totalCapacity}</td>
							</tr>
						</tfoot>
					</table>
				</div>
			</div>
			<div class="app-card-foot small text-secondary">
				Les objectifs sont indicatifs : le générateur cherche à s’en approcher tout en espaçant les
				gardes. Un jour férié tombant un vendredi, samedi ou dimanche est compté dans sa catégorie
				de week-end et dans « Férié ».
			</div>
		</section>
	{/if}

	{#if app.mismatches.length}
		<section class="app-card">
			<div class="app-card-head">
				<h2>
					<i class="bi bi-exclamation-triangle me-2 text-warning"></i>Écarts entre objectifs et
					créneaux
				</h2>
				<span class="badge text-bg-warning ms-auto">{app.mismatches.length}</span>
			</div>
			<div class="app-card-body">
				<p class="section-note">
					Le planning peut tout de même être généré : les objectifs sont souples. Pour un résultat
					parfaitement équilibré, utilisez « Ajuster aux créneaux ».
				</p>
				<div class="d-flex flex-wrap gap-2">
					{#each app.mismatches as mismatch (mismatch.semester + mismatch.category)}
						<span class="chip">
							{mismatch.semester} · {CATEGORY_LABELS[mismatch.category]} :
							<strong class:quota-mismatch={mismatch.targets !== mismatch.capacity}>
								{mismatch.targets} / {mismatch.capacity}
							</strong>
						</span>
					{/each}
				</div>
			</div>
		</section>
	{/if}
{/if}

{#if csvOpen}
	<CsvImportModal onclose={() => (csvOpen = false)} />
{/if}

{#if availabilityId}
	<AvailabilityModal physicianId={availabilityId} onclose={() => (availabilityId = null)} />
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
