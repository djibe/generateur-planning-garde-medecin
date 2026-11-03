<script lang="ts">
	import { tooltip } from '#lib/actions/tooltip.js';
	import { app } from '#lib/stores/app.svelte.js';

	const currentYear = new Date().getFullYear();
	let area = $state('');
	let name = $state('');
	let year = $state(currentYear);
	let alsaceMoselle = $state(false);
	let weekendsAndHolidaysOnly = $state(false);
	let error = $state<string | null>(null);

	const suggested = $derived(`${area.trim() || 'Mon secteur'} — ${year}`);

	function create(event: SubmitEvent) {
		event.preventDefault();
		if (year < 2000 || year > 2200) {
			error = 'Choisissez une année entre 2000 et 2200.';
			return;
		}
		app.createProfile({
			name: name.trim() || suggested,
			area,
			year,
			alsaceMoselle,
			weekendsAndHolidaysOnly
		});
	}

	async function onImport(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		app.importBackup(await file.text());
		input.value = '';
	}
</script>

<div class="container-xxl py-4 py-lg-5">
	<div class="hero">
		<div class="row align-items-center g-4 g-lg-5">
			<div class="col-lg-6">
				<span class="badge text-bg-primary">RecoMédicales</span>
				<h1 class="mt-3 text-balance">Le planning de garde de votre secteur, généré en un clic.</h1>
				<p class="lead text-secondary">
					Un planning annuel équitable, qui respecte les jours fériés français, les absences et vos
					objectifs par médecin — exportable en Excel.
				</p>
				<ul class="list-unstyled d-grid gap-2 mb-0">
					<li>
						<i class="bi bi-check2-circle text-success me-2"></i>Deux semestres équilibrés :
						janv.–juin et juil.–déc.
					</li>
					<li>
						<i class="bi bi-check2-circle text-success me-2"></i>Objectifs par semaine, vendredi,
						samedi, dimanche, veille et jour férié.
					</li>
					<li>
						<i class="bi bi-check2-circle text-success me-2"></i>Espacement maximal entre deux
						gardes.
					</li>
					<li>
						<i class="bi bi-check2-circle text-success me-2"></i>Échanges manuels, verrouillage et
						export Excel par vue.
					</li>
					<li>
						<i class="bi bi-check2-circle text-success me-2"></i>Profils sauvegardés localement,
						rien n’est envoyé sur un serveur.
					</li>
				</ul>
			</div>

			<div class="col-lg-6">
				<div class="app-card">
					<div class="app-card-head">
						<h2>Créer mon premier planning</h2>
						<span class="badge text-bg-light ms-auto">local</span>
					</div>
					<div class="app-card-body">
						<form onsubmit={create} class="d-grid gap-3">
							<div>
								<label class="form-label" for="welcome-area">Secteur</label>
								<input
									id="welcome-area"
									class="form-control form-control-lg"
									bind:value={area}
									placeholder="Ex. Secteur Nord"
								/>
							</div>
							<div class="row g-2">
								<div class="col-sm-5">
									<label class="form-label" for="welcome-year">Année</label>
									<input
										id="welcome-year"
										type="number"
										min="2000"
										max="2200"
										class="form-control"
										bind:value={year}
									/>
								</div>
								<div class="col-sm-7">
									<label class="form-label" for="welcome-name">Nom du profil</label>
									<input
										id="welcome-name"
										class="form-control"
										bind:value={name}
										placeholder={suggested}
									/>
								</div>
							</div>
							<div>
								<div class="form-check">
									<input
										id="welcome-alsace"
										class="form-check-input"
										type="checkbox"
										bind:checked={alsaceMoselle}
									/>
									<label class="form-check-label" for="welcome-alsace">Alsace-Moselle</label>
								</div>
								<div class="form-text">
									Ajoute le Vendredi saint et la Saint-Étienne (26 décembre) aux 11 jours fériés
									métropolitains.
								</div>
							</div>
							<div>
								<div class="form-check">
									<input
										id="welcome-weekends-holidays"
										class="form-check-input"
										type="checkbox"
										bind:checked={weekendsAndHolidaysOnly}
									/>
									<label class="form-check-label" for="welcome-weekends-holidays"
										>Week-ends et jours fériés uniquement</label
									>
								</div>
								<div class="form-text">
									Ne couvre que les samedis, dimanches et jours fériés. Les veilles de férié et les
									jours de semaine restent sans garde.
								</div>
							</div>
							{#if error}
								<div class="alert alert-danger py-2 mb-0 small">{error}</div>
							{/if}
							<button
								type="submit"
								class="btn btn-primary btn-lg"
								use:tooltip={'Créer un nouveau profil de planning'}
							>
								<i class="bi bi-stars me-1"></i> Créer le planning
							</button>
						</form>

						{#if app.profiles.length}
							<div class="divider"></div>
							<div class="eyebrow mb-2">Reprendre un profil</div>
							<div class="d-flex flex-wrap gap-2">
								{#each app.profiles as profile (profile.id)}
									<button
										type="button"
										class="btn btn-sm btn-outline-secondary"
										onclick={() => app.selectProfile(profile.id)}
										use:tooltip={`Ouvrir le profil ${profile.name}`}
									>
										{profile.name}
									</button>
								{/each}
							</div>
						{/if}

						<div class="divider"></div>
						<label class="btn btn-sm btn-outline-secondary w-100">
							<i class="bi bi-upload me-1"></i> Importer une sauvegarde JSON
							<input
								type="file"
								accept="application/json,.json"
								class="d-none"
								onchange={onImport}
							/>
						</label>
						<p class="form-text mt-2 mb-0">
							Les données restent dans ce navigateur (localStorage). Pensez à exporter régulièrement
							une sauvegarde.
						</p>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
