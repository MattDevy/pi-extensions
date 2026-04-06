let activeInstincts: string[] = [];

export function getCurrentActiveInstincts(): string[] {
  return [...activeInstincts];
}

export function setCurrentActiveInstincts(ids: string[]): void {
  activeInstincts = [...ids];
}

export function clearActiveInstincts(): void {
  activeInstincts = [];
}
