export function getRedPhasePrompt(task: string): string {
  return `## TDD: RED Phase -- Write Failing Tests

**Task:** ${task}

Write failing tests for this task. Do NOT write implementation yet.

### Rules
- Write tests that describe the expected behavior
- Each test should assert ONE thing
- Use real code, not mocks, unless external I/O forces it
- After writing tests, RUN them
- Confirm they FAIL because the feature is missing, not because of typos or import errors
- If tests fail with runtime/compile errors, fix the test code first

### Rationalization Prevention
| Excuse | Rebuttal |
|--------|----------|
| "Too simple to test" | Simple code breaks. A test takes 30 seconds. Write it. |
| "I'll write tests after" | No. Tests first. That's the point. |
| "Just this once" | There is no "just this once." TDD is a discipline, not a suggestion. |
| "The types guarantee correctness" | Types don't catch logic errors. Write the test. |

### Verification Gate
After writing tests, you MUST run them and confirm:
1. Tests execute without runtime/compile errors
2. Tests FAIL because the feature is not yet implemented
3. The failure messages describe the missing behavior`;
}
