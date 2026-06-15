export interface MaintenanceBatch {
	id: string;
	createdAt: number;
	paths: string[];
	reason: string;
}

export interface MaintenanceQueueState {
	version: 1;
	batches: MaintenanceBatch[];
}

export interface ActiveMaintenanceRun {
	id: string;
	pid: number;
	startedAt: number;
	batchId: string;
	paths: string[];
	protectedScopes: string[];
	logPath: string;
}

export interface ActiveRunsState {
	version: 1;
	runs: ActiveMaintenanceRun[];
}

export interface LegacyMaintainerLock {
	pid: number;
	runId: string;
	startedAt: number;
}
