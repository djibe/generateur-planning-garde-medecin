<script lang="ts">
	import { onMount } from 'svelte';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import WelcomeScreen from '#lib/components/WelcomeScreen.svelte';
	import { app, type TabId } from '#lib/stores/app.svelte.js';
	import CalendarView from '#lib/views/CalendarView.svelte';
	import DoctorView from '#lib/views/DoctorView.svelte';
	import PhysiciansView from '#lib/views/PhysiciansView.svelte';
	import SummaryView from '#lib/views/SummaryView.svelte';

	const tabs = [
		{ id: 'medecins', label: 'Médecins & objectifs', icon: 'bi-people' },
		{ id: 'synthese', label: 'Synthèse', icon: 'bi-bar-chart' },
		{ id: 'calendrier', label: 'Calendrier', icon: 'bi-calendar3' },
		{ id: 'medecin', label: 'Par médecin', icon: 'bi-person-badge' }
	] as const;

	const validTabs = new Set<string>(tabs.map((tab) => tab.id));

	onMount(() => {
		const sync = () => {
			const hash = window.location.hash.replace('#', '');
			if (validTabs.has(hash) && hash !== app.ui.tab) {
				app.ui = { ...app.ui, tab: hash as TabId };
				app.persistUi();
			}
		};
		sync();
		window.addEventListener('hashchange', sync);
		return () => window.removeEventListener('hashchange', sync);
	});

	function selectTab(id: TabId) {
		app.setTab(id);
	}
</script>

<svelte:head>
	<title>Générateur de planning de garde — RecoMédicales</title>
</svelte:head>

<AppHeader />

{#if !app.ready}
	<div
		class="d-flex flex-column align-items-center justify-content-center gap-3 py-5 my-5 text-secondary"
	>
		<div class="spinner-border" role="status" aria-hidden="true"></div>
		<p class="mb-0">Chargement de vos profils…</p>
	</div>
{:else if !app.active}
	<WelcomeScreen />
{:else}
	<main class="app-main">
		<nav class="tabbar no-print" aria-label="Sections du planning">
			{#each tabs as tab (tab.id)}
				<button
					type="button"
					class:active={app.ui.tab === tab.id}
					onclick={() => selectTab(tab.id)}
					aria-current={app.ui.tab === tab.id ? 'page' : undefined}
				>
					<i class="bi {tab.icon}"></i>
					{tab.label}
					{#if tab.id === 'medecins' && app.active.physicians.length}
						<span class="count">{app.active.physicians.length}</span>
					{/if}
				</button>
			{/each}
		</nav>

		{#if app.ui.tab === 'medecins'}
			<PhysiciansView />
		{:else if app.ui.tab === 'synthese'}
			<SummaryView />
		{:else if app.ui.tab === 'calendrier'}
			<CalendarView />
		{:else}
			<DoctorView />
		{/if}
	</main>
{/if}
