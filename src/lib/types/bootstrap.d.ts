/**
 * Bootstrap ships no TypeScript declarations and `@types/bootstrap` only covers
 * the main entry point (and is pinned to Bootstrap 5.2). This minimal ambient
 * declaration types the single submodule used by the tooltip action.
 */
declare module 'bootstrap/js/src/tooltip.js' {
	export interface TooltipOptions {
		title?: string | Element;
		container?: string | Element;
		trigger?: string;
		delay?: number | { show: number; hide: number };
		placement?: string;
		html?: boolean;
	}

	export default class Tooltip {
		constructor(element: Element, options?: TooltipOptions);
		setContent(content: Record<string, string | Element>): void;
		dispose(): void;
	}
}
