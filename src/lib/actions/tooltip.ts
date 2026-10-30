type TooltipInstance = {
	setContent(content: Record<string, string | Element>): void;
	dispose(): void;
};

type TooltipConstructor = new (
	element: Element,
	options?: {
		title?: string | Element;
		container?: string | Element;
		placement?: string;
		trigger?: string;
		delay?: number | { show: number; hide: number };
	}
) => TooltipInstance;

let TooltipClass: TooltipConstructor | null = null;
let loading: Promise<TooltipConstructor> | null = null;

/**
 * Loads Bootstrap's Tooltip lazily so the module is never evaluated during SSR:
 * Bootstrap accesses `document` at import time and would break prerendering.
 */
function loadTooltip(): Promise<TooltipConstructor> {
	if (TooltipClass) return Promise.resolve(TooltipClass);
	loading ??= import('bootstrap/js/src/tooltip.js').then((module) => {
		const ctor = module.default as unknown as TooltipConstructor;
		TooltipClass = ctor;
		return ctor;
	});
	return loading;
}

/**
 * Svelte action that turns an element into a Bootstrap 5 tooltip.
 *
 * Usage: `<button use:tooltip={'Short explanation'}>…</button>`
 * Dynamic texts are supported through `use:tooltip={value}`.
 */
export function tooltip(node: HTMLElement, text: string) {
	let current = text;
	let instance: TooltipInstance | null = null;
	let destroyed = false;

	void loadTooltip().then((Tooltip) => {
		if (destroyed || !current) return;
		instance = new Tooltip(node, {
			title: current,
			// Append to the surrounding native <dialog> so the tooltip stays in the
			// top layer; elsewhere `body` avoids clipping by scrollable containers.
			container: node.closest('dialog') ?? 'body',
			placement: 'bottom',
			trigger: 'hover focus',
			delay: { show: 300, hide: 100 }
		});
	});

	return {
		update(next: string) {
			current = next;
			if (instance && current) instance.setContent({ '.tooltip-inner': current });
		},
		destroy() {
			destroyed = true;
			instance?.dispose();
			instance = null;
		}
	};
}
