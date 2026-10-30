import { generateSchedule } from '#lib/domain/generator.js';
import type { GenerateRequest, GenerateResponse } from './generator.protocol.js';

interface WorkerScope {
	onmessage: ((event: MessageEvent<GenerateRequest>) => void) | null;
	postMessage(message: GenerateResponse): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
	const { id, options } = event.data;
	try {
		scope.postMessage({ id, result: generateSchedule(options) });
	} catch (error) {
		scope.postMessage({
			id,
			error: error instanceof Error ? error.message : String(error)
		});
	}
};
