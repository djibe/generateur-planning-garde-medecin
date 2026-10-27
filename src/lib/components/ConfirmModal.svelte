<script lang="ts">
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
		<button type="button" class="btn btn-outline-secondary" onclick={onclose}>Annuler</button>
		<button
			type="button"
			class="btn {danger ? 'btn-danger' : 'btn-primary'}"
			onclick={() => {
				onconfirm();
				onclose();
			}}
		>
			{confirmLabel}
		</button>
	{/snippet}
</Modal>
