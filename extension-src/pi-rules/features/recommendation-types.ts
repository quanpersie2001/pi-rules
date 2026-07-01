export type RecommendationStatus = "pending" | "approved" | "cancelled" | "completed" | "error";

export interface Recommendation {
	id: string;
	rulePath: string;
	ruleRelativePath: string;
	changedFiles?: string[];
	fileCount?: number;
	extensionSummary?: string;
	summary: string;
	content: string;
	reason: string;
	status: RecommendationStatus;
	createdAt: number;
	updatedAt: number;
	mergeCount: number;
	approvedAt?: number;
	completedAt?: number;
	error?: string;
}

export interface RecommendationsState {
	version: 1;
	recommendations: Recommendation[];
}

export interface ApplyResult {
	id: string;
	success: boolean;
	message: string;
}
