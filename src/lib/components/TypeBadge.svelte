<script lang="ts">
	import { SLOT_TYPE_LABEL } from '#lib/domain/calendar.js';
	import type { Category } from '#lib/domain/types.js';

	let { type, weekend = false }: { type: Category; weekend?: boolean } = $props();

	const label = $derived(
		weekend ? (type === 'holiday' ? 'Week-end férié' : 'Week-end') : SLOT_TYPE_LABEL[type]
	);
</script>

<span class="type-badge type-{type}"><span class="dot"></span>{label}</span>
