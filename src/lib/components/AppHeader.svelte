<script lang="ts">
	import { tooltip } from '#lib/actions/tooltip.js';
	import { app } from '#lib/stores/app.svelte.js';
	import { formatDateTime } from '#lib/utils/date.js';
	import ConfirmModal from './ConfirmModal.svelte';
	import NewProfileModal from './NewProfileModal.svelte';

	let newOpen = $state(false);
	let deleteOpen = $state(false);

	function onProfileChange(event: Event) {
		const id = (event.currentTarget as HTMLSelectElement).value;
		if (id) app.selectProfile(id);
	}

	async function onImportFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const text = await file.text();
		app.importBackup(text);
		input.value = '';
	}
</script>

<header class="app-header no-print">
	<div class="container-xxl d-flex align-items-center gap-3 flex-wrap py-2">
		<a class="brand" href="#medecins">
			<img class="brand-logo" src="logo.svg" alt="" width="36" height="36" />
			<span class="brand-text">
				<strong>Planning de garde</strong>
				<small>par RecoMédicales</small>
			</span>
		</a>

		{#if app.profiles.length}
			<div class="profile-switcher">
				<select
					class="form-select form-select-sm"
					value={app.active?.id ?? ''}
					onchange={onProfileChange}
					aria-label="Profil de planning"
				>
					{#each app.profiles as profile (profile.id)}
						<option value={profile.id}>{profile.name}</option>
					{/each}
				</select>
			</div>
		{/if}

		<div class="ms-auto d-flex align-items-center gap-1 gap-sm-2 flex-wrap">
			<button
				type="button"
				class="btn btn-sm btn-outline-secondary"
				onclick={() => (newOpen = true)}
				use:tooltip={'Nouveau profil'}
			>
				<i class="bi bi-plus-lg"></i>
				<span class="d-none d-lg-inline ms-1">Nouveau</span>
			</button>

			{#if app.active}
				<button
					type="button"
					class="btn btn-sm btn-outline-secondary"
					onclick={() => app.duplicateProfile()}
					use:tooltip={"Dupliquer ce profil pour l'année suivante"}
				>
					<i class="bi bi-copy"></i>
					<span class="d-none d-xl-inline ms-1">Dupliquer</span>
				</button>
				<button
					type="button"
					class="btn btn-sm btn-outline-danger"
					aria-label="Supprimer ce profil"
					onclick={() => (deleteOpen = true)}
					use:tooltip={'Supprimer ce profil'}
				>
					<i class="bi bi-trash3"></i>
				</button>
			{/if}

			<span class="vr d-none d-lg-block mx-1"></span>

			<details class="details-menu position-relative">
				<summary class="btn btn-sm btn-outline-secondary" title="Sauvegarde et import">
					<i class="bi bi-archive"></i>
					<span class="d-none d-xl-inline ms-1">Données</span>
				</summary>
				<div class="menu">
					<button
						type="button"
						onclick={() => app.exportBackup()}
						use:tooltip={'Télécharger une sauvegarde de tous les profils'}
					>
						<i class="bi bi-download"></i> Exporter tous les profils (.json)
					</button>
					<label>
						<i class="bi bi-upload"></i> Importer une sauvegarde
						<input
							type="file"
							accept="application/json,.json"
							class="d-none"
							onchange={onImportFile}
						/>
					</label>
				</div>
			</details>

			<button
				type="button"
				class="btn btn-sm btn-icon"
				onclick={() => app.toggleTheme()}
				use:tooltip={app.ui.theme === 'light'
					? 'Activer le thème sombre'
					: 'Activer le thème clair'}
				aria-label="Basculer le thème"
			>
				<i class={app.ui.theme === 'light' ? 'bi bi-moon-stars' : 'bi bi-sun'}></i>
			</button>

			{#if app.active}
				<button
					type="button"
					class="btn btn-primary btn-sm px-3"
					onclick={() => app.generate()}
					disabled={!app.active.physicians.length}
					use:tooltip={'Générer ou régénérer le planning'}
				>
					<i class="bi bi-stars me-1"></i> Générer
				</button>
			{/if}
		</div>
	</div>

	{#if app.active}
		<div class="status-bar">
			<div class="container-xxl d-flex align-items-center gap-3 flex-wrap">
				<span
					><i class="bi bi-geo-alt"></i>{app.active.area || 'Secteur non nommé'} · {app.active
						.year}</span
				>
				<span>
					<i class="bi bi-calendar3"></i>
					{app.active.settings.weekendMode === 'combined'
						? 'Week-ends groupés (2 jours)'
						: 'Week-ends séparés'}
				</span>
				{#if app.generated}
					<span
						><i class="bi bi-clock-history"></i>Généré le {formatDateTime(
							app.active.generatedAt
						)}</span
					>
				{:else}
					<span class="text-warning-emphasis">
						<i class="bi bi-exclamation-circle"></i>Planning non généré
					</span>
				{/if}
				{#if app.stale && app.generated}
					<span class="badge text-bg-warning">Données modifiées · à régénérer</span>
				{/if}
				{#if app.mismatches.length}
					<span class="badge text-bg-danger">{app.mismatches.length} écart(s) d'objectifs</span>
				{/if}
				<span class="ms-auto">
					{#if app.saving}
						<span class="save-indicator"
							><span class="spinner-border spinner-border-sm"></span> Enregistrement…</span
						>
					{:else if app.storageError}
						<span class="text-danger"
							><i class="bi bi-exclamation-triangle"></i>Stockage saturé</span
						>
					{:else if app.lastSavedAt}
						<span class="text-success-emphasis"><i class="bi bi-check2"></i>Enregistré</span>
					{/if}
				</span>
			</div>
		</div>
	{/if}
</header>

{#if newOpen}
	<NewProfileModal onclose={() => (newOpen = false)} />
{/if}

{#if deleteOpen && app.active}
	<ConfirmModal
		title="Supprimer le profil"
		message="Le profil « {app.active
			.name} » et tout son planning seront définitivement supprimés de ce navigateur."
		confirmLabel="Supprimer"
		danger
		onconfirm={() => app.deleteProfile(app.active?.id ?? '')}
		onclose={() => (deleteOpen = false)}
	/>
{/if}
