<script lang="ts">
	import '@fontsource/roboto/400.css';
	import '@fontsource/roboto/500.css';
	import '@fontsource/roboto/700.css';
	import 'bootstrap-icons/font/bootstrap-icons.css';
	import '../app.scss';

	import { onMount } from 'svelte';
	import ToastHost from '#lib/components/ToastHost.svelte';
	import { app } from '#lib/stores/app.svelte.js';

	let { children } = $props();

	onMount(() => {
		app.init();

		const flush = () => app.flushSave();
		const onVisibility = () => {
			if (document.hidden) app.flushSave();
		};

		window.addEventListener('beforeunload', flush);
		document.addEventListener('visibilitychange', onVisibility);

		return () => {
			window.removeEventListener('beforeunload', flush);
			document.removeEventListener('visibilitychange', onVisibility);
		};
	});

	// Persist every change of the active profile (debounced inside the store).
	$effect(() => {
		if (!app.ready || !app.active) return;
		app.queueSave(app.active.id, JSON.stringify(app.active));
	});

	$effect(() => {
		if (typeof document === 'undefined') return;
		document.documentElement.dataset.bsTheme = app.ui.theme;
	});
</script>

<ToastHost />
{@render children()}
