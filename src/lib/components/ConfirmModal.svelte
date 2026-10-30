<script lang="ts">
	import { tooltip } from '#lib/actions/tooltip.js';
	import Modal from './Modal.svelte';

	let {
		title = 'Confirmer',
		message,
		confirmLabel = 'Confirmer',
		danger = false,
		onconfirm,
		onclose
	}: {
		title?: string;
		message: string;
		confirmLabel?: string;
		danger?: boolean;
		onconfirm: () => void;
		onclose: () => void;
	} = $props();
</script>

<Modal {title} {onclose} size="sm">
	<p class="mb-0">{message}</p>
	{#snippet footer()}
		<button
			type="button"
			class="btn btn-outline-secondary"
			use:tooltip={'Annuler et fermer'}
			onclick={onclose}>Annuler</button
		>
		<button
			type="button"
			class="btn {danger ? 'btn-danger' : 'btn-primary'}"
			use:tooltip={danger ? 'Confirmer la suppression' : 'Confirmer l’action'}
			onclick={() => {
				onconfirm();
				onclose();
			}}
		>
			{confirmLabel}
		</button>
	{/snippet}
</Modal>
