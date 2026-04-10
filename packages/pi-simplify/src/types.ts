export interface ChangedFile {
  readonly path: string;
  readonly status: "modified" | "added" | "renamed" | "copied";
}

export interface SimplifyOptions {
  readonly files: readonly string[];
  readonly ref: string;
  readonly staged: boolean;
}
