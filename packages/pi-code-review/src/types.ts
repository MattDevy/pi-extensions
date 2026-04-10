export type ReviewSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "INFO";

export interface ReviewFinding {
  readonly severity: ReviewSeverity;
  readonly file: string;
  readonly line?: number;
  readonly category: string;
  readonly message: string;
  readonly suggestion?: string;
}

export interface EditedFile {
  readonly path: string;
  readonly language: string | null;
}

export interface TurnEdits {
  readonly files: readonly EditedFile[];
  readonly turnIndex: number;
}

export interface ReviewResult {
  readonly findings: readonly ReviewFinding[];
  readonly filesReviewed: readonly string[];
}
