export function safeFileName(value: string): string {
	return (
		value
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-zA-Z0-9-_]+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '')
			.toLowerCase() || 'export'
	);
}

export function downloadBlob(filename: string, blob: Blob): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.rel = 'noopener';
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
	downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}
