export function getRefactorPhasePrompt(task: string): string {
  return `## TDD: REFACTOR Phase -- Improve Without Breaking

**Task:** ${task}

All tests pass. Refactor if needed: remove duplication, improve names, extract helpers.

### Rules
- Keep tests green. Do not add new behavior.
- RUN tests after every refactor to confirm they still pass
- If a refactoring breaks tests, revert the last change immediately
- This phase is optional. If the code is clean, advance to the next task.`;
}
