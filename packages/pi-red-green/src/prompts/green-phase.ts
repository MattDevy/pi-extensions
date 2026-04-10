export function getGreenPhasePrompt(task: string, failedCount: number): string {
  return `## TDD: GREEN Phase -- Make Tests Pass

**Task:** ${task}
**Failing tests:** ${failedCount}

Tests are failing as expected. Write the SIMPLEST code to make them pass.

### Rules
- Write the minimal implementation to satisfy the failing tests
- Do not add features beyond what tests require
- Do not refactor other code
- Do not "improve" or "clean up" during this phase
- After writing implementation, RUN tests and confirm they pass

### Anti-patterns
- Don't add untested features "while you're in there"
- Don't mock behavior that should be real
- Don't add test-only methods to production classes`;
}
