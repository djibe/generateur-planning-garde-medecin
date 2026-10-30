<script lang="ts">
	import { tooltip } from '#lib/actions/tooltip.js';
	import { app } from '#lib/stores/app.svelte.js';
	import Modal from './Modal.svelte';

	let { onclose }: { onclose: () => void } = $props();

	const currentYear = new Date().getFullYear();
	let name = $state('');
	let area = $state('');
	let year = $state(currentYear);

	const suggested = $derived(`${area.trim() || 'Mon secteur'} — ${year}`);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		app.createProfile({ name: name.trim() || suggested, area, year });
		onclose();
	}
</script>

<Modal title="Nouveau profil" {onclose} size="sm">
	<form onsubmit={submit} class="d-grid gap-3">
		<div>
			<label class="form-label" for="np-area">Secteur concerné</label>
			<input id="np-area" class="form-control" bind:value={area} placeholder="Ex. Secteur Nord" />
			<div class="form-text">Le nom de la zone couverte par les gardes.</div>
		</div>
		<div>
			<label class="form-label" for="np-year">Année du planning</label>
			<input
				id="np-year"
				type="number"
				min="2000"
				max="2200"
				class="form-control"
				bind:value={year}
			/>
		</div>
		<div>
			<label class="form-label" for="np-name">Nom du profil</label>
			<input id="np-name" class="form-control" bind:value={name} placeholder={suggested} />
			<div class="form-text">Sert à retrouver le planning dans la liste des profils.</div>
		</div>
		<div class="d-flex justify-content-end gap-2 pt-1">
			<button
				type="button"
				class="btn btn-outline-secondary"
				use:tooltip={'Annuler la création'}
				onclick={onclose}>Annuler</button
			>
			<button
				type="submit"
				class="btn btn-primary"
				use:tooltip={'Créer le profil et ouvrir le planning'}>Créer le profil</button
			>
		</div>
	</form>
</Modal>
