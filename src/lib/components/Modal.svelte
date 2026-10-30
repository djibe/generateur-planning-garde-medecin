<script lang="ts">
	import { tooltip } from '#lib/actions/tooltip.js';
	import { onMount, type Snippet } from 'svelte';

	let {
		title = '',
		onclose,
		children,
		footer,
		size = ''
	}: {
		title?: string;
		onclose: () => void;
		children?: Snippet;
		footer?: Snippet;
		size?: '' | 'sm' | 'lg';
	} = $props();

	let dialog = $state<HTMLDialogElement | null>(null);
	let closed = false;

	function close() {
		if (closed) return;
		closed = true;
		onclose();
	}

	onMount(() => {
		if (dialog && !dialog.open) dialog.showModal();
		return () => {
			if (dialog?.open) dialog.close();
		};
	});
</script>

<dialog
	bind:this={dialog}
	class="app-modal"
	onclose={close}
	oncancel={(event) => {
		event.preventDefault();
		close();
	}}
>
	<div class="app-modal-card {size}">
		<header class="app-modal-head">
			<h2>{title}</h2>
			<button
				type="button"
				class="btn-close ms-auto"
				aria-label="Fermer"
				use:tooltip={'Fermer'}
				onclick={close}
			></button>
		</header>
		<div class="app-modal-body">
			{@render children?.()}
		</div>
		{#if footer}
			<div class="app-modal-foot">
				{@render footer()}
			</div>
		{/if}
	</div>
</dialog>
