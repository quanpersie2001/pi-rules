export function now(): number {
	return Date.now();
}

export function toIsoDate(timestamp: number = Date.now()): string {
	return new Date(timestamp).toISOString();
}
