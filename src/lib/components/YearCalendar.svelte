<script lang="ts">
	import { tooltip } from '#lib/actions/tooltip.js';
	import {
		eachDay,
		formatLong,
		formatMonth,
		monthEnd,
		monthStart,
		weekdayIndex
	} from '#lib/utils/date.js';
	import type { Slot } from '#lib/domain/types.js';

	let {
		year,
		slots,
		label,
		onSlotClick,
		highlightId = null,
		conflictIds = null,
		monthFrom = 0,
		monthTo = 11
	}: {
		year: number;
		slots: Slot[];
		label: (slot: Slot) => string | null;
		onSlotClick?: (slot: Slot) => void;
		highlightId?: string | null;
		conflictIds?: Set<string> | null;
		monthFrom?: number;
		monthTo?: number;
	} = $props();

	interface Cell {
		blank: boolean;
		key: string;
		date?: string;
		day?: number;
		slot?: Slot;
		name?: string | null;
	}

	interface Month {
		index: number;
		title: string;
		cells: Cell[];
		count: number;
	}

	const weekdays = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

	const months = $derived.by(() => {
		const byDate = new Map<string, Slot>();
		for (const slot of slots) {
			for (const date of slot.dates) byDate.set(date, slot);
		}

		const result: Month[] = [];
		for (let index = monthFrom; index <= monthTo; index += 1) {
			const first = monthStart(year, index);
			const last = monthEnd(year, index);
			const cells: Cell[] = [];

			const lead = weekdayIndex(first);
			for (let count = 0; count < lead; count += 1) {
				cells.push({ blank: true, key: `blank-${index}-${count}` });
			}

			let filled = 0;
			for (const date of eachDay(first, last)) {
				const slot = byDate.get(date);
				if (slot) filled += 1;
				cells.push({
					blank: false,
					key: date,
					date,
					day: Number(date.slice(8, 10)),
					slot,
					name: slot ? label(slot) : null
				});
			}

			result.push({ index, title: formatMonth(year, index), cells, count: filled });
		}
		return result;
	});

	function classes(cell: Cell): string {
		const slot = cell.slot;
		if (!slot) return 'day';
		const parts = ['day', 'filled', `type-${slot.type}`];
		if (onSlotClick) parts.push('clickable');
		if (slot.holidayName) parts.push('is-holiday');
		if (slot.isWeekendBlock && slot.start === cell.date) parts.push('weekend-start');
		if (slot.isWeekendBlock && slot.end === cell.date) parts.push('weekend-end');
		if (highlightId && slot.id === highlightId) parts.push('is-pinned');
		if (conflictIds?.has(slot.id)) parts.push('is-conflict');
		if (cell.name === null) parts.push('muted');
		return parts.join(' ');
	}

	function title(cell: Cell): string {
		if (!cell.date) return '';
		const name = cell.name ? ` — ${cell.name}` : '';
		const holiday = cell.slot?.holidayName ? ` · ${cell.slot.holidayName}` : '';
		return `${formatLong(cell.date)}${name}${holiday}`;
	}
</script>

<div class="months-grid">
	{#each months as month (month.index)}
		<section class="month-card">
			<header class="month-head">
				<span>{month.title}</span>
				<span class="month-meta">{month.count} garde{month.count > 1 ? 's' : ''}</span>
			</header>
			<div class="month-grid">
				{#each weekdays as weekday}
					<div class="dow">{weekday}</div>
				{/each}

				{#each month.cells as cell (cell.key)}
					{#if cell.blank}
						<div class="day blank"></div>
					{:else if cell.slot}
						<button
							type="button"
							class={classes(cell)}
							disabled={!onSlotClick}
							use:tooltip={title(cell)}
							onclick={() => cell.slot && onSlotClick?.(cell.slot)}
						>
							<span class="day-num">{cell.day}</span>
							{#if cell.name}
								<span class="day-name">{cell.name}</span>
							{/if}
							{#if cell.slot.holidayName}
								<span class="day-extra">{cell.slot.holidayName}</span>
							{/if}
						</button>
					{:else}
						<div class="day">
							<span class="day-num">{cell.day}</span>
						</div>
					{/if}
				{/each}
			</div>
		</section>
	{/each}
</div>
