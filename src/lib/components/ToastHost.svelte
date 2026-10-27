<script lang="ts">
	import { app } from '#lib/stores/app.svelte.js';

	const icons: Record<string, string> = {
		success: 'bi-check-circle-fill',
		danger: 'bi-exclamation-octagon-fill',
		info: 'bi-info-circle-fill'
	};
</script>

<div class="toast-stack no-print" aria-live="polite">
	{#each app.toasts as toast (toast.id)}
		<div class="app-toast {toast.kind}" role="status">
			<i class="bi {icons[toast.kind]} icon"></i>
			<span class="flex-grow-1">{toast.message}</span>
			<button type="button" onclick={() => app.dismissToast(toast.id)} aria-label="Fermer">
				<i class="bi bi-x-lg"></i>
			</button>
		</div>
	{/each}
</div>
