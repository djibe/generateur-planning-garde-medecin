import type { GenerateOptions, GenerateResult } from '#lib/domain/generator.js';

export interface GenerateRequest {
	id: number;
	options: GenerateOptions;
}

export interface GenerateResponse {
	id: number;
	result?: GenerateResult;
	error?: string;
}
