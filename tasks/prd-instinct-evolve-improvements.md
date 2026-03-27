# PRD: Instinct Evolve Improvements

## 1. Introduction / Overview

The `/instinct-evolve` command currently surfaces three types of suggestions: merge candidates (instincts with similar triggers), potential slash commands (workflow instincts), and promotion candidates (project instincts ready for global scope). It operates purely within the instinct store and has no awareness of the broader Pi ecosystem - installed skills, AGENTS.md project guidelines, or even deep semantic duplication across instincts themselves.

This PRD extends `/instinct-evolve` and the background Haiku analyzer with five new capabilities:

1. **Skill promotion suggestions** - identify instinct clusters that could be formalized into a Pi skill file
2. **AGENTS.md duplication prevention** - stop the analyzer from creating instincts that already exist in AGENTS.md, and flag any that slipped through
3. **AGENTS.md addition suggestions** - recommend what high-confidence instincts should be graduated into permanent AGENTS.md guidelines
4. **Installed-skill deduplication** - prevent instincts from shadowing behaviors already covered by installed Pi skills
5. **Deep instinct deduplication** - surface semantically redundant instincts (not just trigger-similar ones) with explicit merge/delete recommendations

---

## 2. Goals

- Prevent the instinct store from growing stale with content already covered by skills or AGENTS.md
- Surface actionable pathways for graduating instincts into more permanent artifacts (skills, AGENTS.md)
- Keep `/instinct-evolve` purely informational - no automatic file mutations
- Both the background analyzer and the evolve command share the same awareness, giving a two-layer defense against duplication
- All new logic is unit-testable and follows existing module conventions (files under 400 lines, functions under 50 lines)

---

## 3. User Stories

### US-001: Skill Promotion Suggestions

**Description:** As a Pi user, I want `/instinct-evolve` to identify which instincts (individually or as a cluster) have enough depth and coherence to be formalized into a Pi skill file, so I know what behaviors are mature enough to extract.

**Acceptance Criteria:**
- [ ] `/instinct-evolve` output includes a "Skill Promotion Candidates" section when qualifying instincts exist
- [ ] A suggestion is shown for any individual instinct with confidence >= 0.8 whose `domain` maps to a recognized skill domain (testing, git, debugging, workflow, etc.)
- [ ] A suggestion is also shown for any merge-candidate cluster where all member instincts have confidence >= 0.7 and together span a coherent domain
- [ ] Each suggestion includes: instinct IDs, why this could be a skill, and what the skill's trigger/purpose would be
- [ ] No skill file is written - output is purely informational text
- [ ] The suggestion explicitly does NOT appear if an installed skill with the same domain/purpose already exists (see US-005)
- [ ] Tests pass, typecheck passes, lint passes

---

### US-002: Analyzer AGENTS.md Awareness (Prevention Layer)

**Description:** As a Pi user, I want the background Haiku analyzer to read existing AGENTS.md content before creating new instincts, so I don't accumulate instincts that just repeat project or global guidelines.

**Acceptance Criteria:**
- [ ] At analysis time, the project's local AGENTS.md (if it exists at the project root) is read and appended to the analyzer user prompt
- [ ] The global AGENTS.md (`~/.pi/agent/AGENTS.md`) is also read and appended to the analyzer user prompt
- [ ] The analyzer system prompt includes a "Avoid Duplicating Guidelines" section instructing Haiku to check both AGENTS.md texts before creating any instinct
- [ ] If an observation pattern is already fully covered by an AGENTS.md rule, Haiku must skip creating or updating the instinct
- [ ] `buildAnalyzerUserPrompt` accepts optional `agentsMdProject` and `agentsMdGlobal` string parameters
- [ ] `buildAnalyzerSystemPrompt` includes the new avoidance instruction section
- [ ] Unit tests cover the new parameters in `analyzer-user.ts` and the new section in `analyzer-system.ts`
- [ ] Tests pass, typecheck passes, lint passes

---

### US-003: `/instinct-evolve` AGENTS.md Overlap Flagging (Post-hoc Layer)

**Description:** As a Pi user, I want `/instinct-evolve` to compare all existing instincts against AGENTS.md content and flag any that duplicate guidelines already written there, so I can clean up the instinct store.

**Acceptance Criteria:**
- [ ] `/instinct-evolve` reads both the project's local AGENTS.md and the global AGENTS.md at command run time
- [ ] For each instinct, it checks whether the instinct's `trigger` + `action` text is semantically covered by any AGENTS.md section (keyword/phrase overlap check - no LLM call)
- [ ] Flagged instincts appear in a new "Duplicates AGENTS.md" section in the output
- [ ] Each flag includes: instinct ID, confidence, and the matching AGENTS.md excerpt (up to 100 chars)
- [ ] If no AGENTS.md files exist, the section is silently omitted
- [ ] `handleInstinctEvolve` receives project root path to locate local AGENTS.md
- [ ] Unit tests cover overlap detection logic with fixture AGENTS.md content
- [ ] Tests pass, typecheck passes, lint passes

---

### US-004: AGENTS.md Addition Suggestions

**Description:** As a Pi user, I want `/instinct-evolve` to suggest what I could add to my project or global AGENTS.md, based on high-confidence instincts, so I can graduate stable behaviors into permanent guidelines.

**Acceptance Criteria:**
- [ ] `/instinct-evolve` output includes two sub-sections: "Suggested Project AGENTS.md Additions" and "Suggested Global AGENTS.md Additions"
- [ ] A suggestion appears for any project-scoped instinct with confidence >= 0.75 that is NOT already flagged as duplicating AGENTS.md (US-003)
- [ ] A suggestion appears for any global-scoped instinct with confidence >= 0.8 that is NOT already in global AGENTS.md
- [ ] Each suggestion includes: the proposed AGENTS.md bullet text (derived from the instinct's trigger + action), and a note that the user should edit the file manually
- [ ] No AGENTS.md file is written or modified
- [ ] Tests pass, typecheck passes, lint passes

---

### US-005: Installed Skills Deduplication

**Description:** As a Pi user, I want both the analyzer and `/instinct-evolve` to know which Pi skills are installed so they don't create or retain instincts that duplicate installed skill behaviors.

**Acceptance Criteria:**
- [ ] At `session_start`, `index.ts` reads the list of installed skills from the Pi ExtensionAPI (e.g., `pi.getInstalledSkills()` or equivalent - to be confirmed against Pi SDK). If no such API exists, fall back to scanning known Pi package skill directories
- [ ] The installed skill list (name + description) is passed to `buildAnalyzerUserPrompt` as an `installedSkills` parameter
- [ ] The analyzer system prompt includes an "Avoid Duplicating Installed Skills" section instructing Haiku not to create instincts for behaviors already in a named skill
- [ ] `handleInstinctEvolve` receives the installed skill list and compares each instinct's `domain` and `trigger` tokens against skill names/descriptions
- [ ] Instincts that overlap with an installed skill appear in a "Shadowed by Installed Skill" section in `/instinct-evolve` output, noting the skill name
- [ ] Skill promotion suggestions (US-001) suppress themselves if an overlapping skill is already installed
- [ ] Unit tests for the skill overlap detection function (pure string-matching, no Pi API)
- [ ] Tests pass, typecheck passes, lint passes

---

### US-006: Deep Instinct Deduplication

**Description:** As a Pi user, I want `/instinct-evolve` to surface semantically redundant instincts beyond trigger-similarity, comparing `action` text and `evidence` to catch pairs where the actual recommended behavior is the same, so I can keep the instinct store concise.

**Acceptance Criteria:**
- [ ] Existing trigger-similarity merge candidates (Jaccard >= 0.3) remain unchanged
- [ ] A second deduplication pass compares `action` text between all instinct pairs using Jaccard token similarity (same algorithm, threshold 0.4 on action tokens)
- [ ] Pairs identified by action similarity but NOT already caught by trigger similarity appear as additional merge candidates
- [ ] Each merge candidate now explicitly recommends one of: "merge into one instinct" or "delete lower-confidence duplicate", including which ID to keep and which to remove
- [ ] Action token similarity uses the same `tokenizeTrigger` helper (renamed to `tokenizeText` to reflect broader use)
- [ ] All existing tests for `triggerSimilarity` and `tokenizeTrigger` are updated to use `tokenizeText`
- [ ] New unit tests cover action-based deduplication and the keep/delete recommendation logic
- [ ] Tests pass, typecheck passes, lint passes

---

## 4. Functional Requirements

**FR-1:** `buildAnalyzerUserPrompt` must accept two new optional parameters: `agentsMdProject: string | null` and `agentsMdGlobal: string | null`. When non-null, they are appended to the prompt under a "## Existing Guidelines" section.

**FR-2:** `buildAnalyzerUserPrompt` must accept a new optional parameter: `installedSkills: Array<{ name: string; description: string }>`. When non-empty, the list is appended under "## Installed Skills".

**FR-3:** `buildAnalyzerSystemPrompt` must include two new sections: "Avoid Duplicating Guidelines" and "Avoid Duplicating Installed Skills", each with explicit rules for Haiku to follow.

**FR-4:** `handleInstinctEvolve` signature must be extended to accept `projectRoot: string | null`, `agentsMdGlobal: string | null`, and `installedSkills: InstalledSkill[]`. `index.ts` must supply these from session context.

**FR-5:** `generateEvolveSuggestions` must return suggestions of five types: `merge`, `command`, `promotion`, `skill-promotion`, `agents-md-overlap`, `agents-md-addition`, `skill-shadow`. (The `command` type remains unchanged.)

**FR-6:** `formatEvolveSuggestions` must render each suggestion type in a clearly labeled section, keeping sections silent (omitted) when they have zero entries.

**FR-7:** `tokenizeTrigger` must be renamed to `tokenizeText` and re-exported. All callers updated. Tests updated accordingly.

**FR-8:** A new helper `actionSimilarity(a: Instinct, b: Instinct): number` must compute Jaccard similarity on action token sets, using `tokenizeText`.

**FR-9:** `findMergeCandidates` must run both the trigger-similarity pass (threshold 0.3) and the action-similarity pass (threshold 0.4), deduplicating pairs that appear in both. Each resulting `MergeSuggestion` must include a `recommendation: "merge" | "delete-lower"` field and `keepId: string` (the higher-confidence instinct's ID).

**FR-10:** A new `InstalledSkill` interface must be added to `types.ts`: `{ name: string; description: string }`.

**FR-11:** A new `readAgentsMd(filePath: string): string | null` utility function must be added (reads file, returns content or null if not found) - either in `storage.ts` or a new `agents-md.ts` file.

**FR-12:** Skill promotion detection must use a `SKILL_DOMAINS` constant mapping known Pi skill domains (e.g., "git", "testing", "debugging", "workflow", "typescript") to human-readable purposes, defined in `config.ts`.

**FR-13:** AGENTS.md overlap detection must be purely lexical (no LLM): extract significant words from each instinct's trigger + action; check if >= 60% appear in the AGENTS.md text. Threshold defined as `AGENTS_MD_OVERLAP_THRESHOLD = 0.6` in `instinct-evolve.ts`.

---

## 5. Non-Goals (Out of Scope)

- Automatically writing or modifying skill files, AGENTS.md, or instinct files
- LLM-based semantic comparison (all matching is lexical/token-based)
- Creating new slash commands automatically based on suggestions
- Modifying the confidence scoring or feedback loop logic
- Changing how instincts are stored or their file format
- Any UI beyond text output via `ctx.ui.notify`

---

## 6. Technical Considerations

### Pi SDK - Installed Skills Discovery

The exact Pi ExtensionAPI method for listing installed skills is unknown at PRD time. `index.ts` should attempt `pi.getInstalledSkills()` (or equivalent) inside a try-catch and fall back to an empty array if the method doesn't exist. A TODO comment must be left for the implementer to verify the actual API. If no API exists, scan `~/.pi/agent/skills/*/SKILL.md` and the global pi-package skill directories, parsing `name` and `description` from YAML frontmatter.

### AGENTS.md Path Resolution

- Project AGENTS.md: `{projectRoot}/AGENTS.md`
- Global AGENTS.md: `~/.pi/agent/AGENTS.md` (use `os.homedir()`)
- Both are read at command invocation time (not cached), so changes to AGENTS.md during a session are picked up

### Module Size

`instinct-evolve.ts` is currently 326 lines. Adding five new suggestion types will push it over 400 lines. Extract suggestion generators into a separate `instinct-evolve-generators.ts` file, keeping `instinct-evolve.ts` as the command handler and formatter only (< 200 lines).

### File Layout After This Feature

```
src/
  instinct-evolve.ts           # Command handler + formatter (< 200 lines)
  instinct-evolve-generators.ts # All findX() functions (< 400 lines)
  agents-md.ts                  # readAgentsMd() utility
  types.ts                      # + InstalledSkill interface
  config.ts                     # + SKILL_DOMAINS, AGENTS_MD_OVERLAP_THRESHOLD
  prompts/
    analyzer-system.ts          # + 2 new sections
    analyzer-user.ts            # + agentsMdProject, agentsMdGlobal, installedSkills params
```

---

## 7. Success Metrics

- `/instinct-evolve` output surfaces at least one correct duplication or graduation suggestion in a session with 10+ instincts
- Zero false positives where an instinct is flagged as duplicating AGENTS.md when it does not
- Background analyzer stops generating instincts that mirror AGENTS.md rules (verified by inspection after 1 week of sessions)
- All unit tests pass; overall coverage stays >= 80%

---

## 8. Open Questions

1. **Pi SDK skill discovery API**: Does `ExtensionAPI` expose installed skills at runtime? If not, which file paths are reliable for scanning SKILL.md files across all Pi package locations?

2. **Overlap threshold tuning**: The 60% lexical overlap threshold for AGENTS.md duplication detection is a starting point. Should it be configurable via `config.json`?

3. **Global AGENTS.md path**: Is `~/.pi/agent/AGENTS.md` the correct canonical path for the global agent guidelines? Confirm against Pi SDK conventions.

4. **`tokenizeText` rename**: Renaming `tokenizeTrigger` is a breaking change for external callers. Since this is a pi-package with no public API guarantees, a direct rename is acceptable - but confirm no downstream consumers exist.
