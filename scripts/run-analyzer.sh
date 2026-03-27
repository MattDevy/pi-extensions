#!/usr/bin/env bash
#
# Manually trigger the pi-continuous-learning analyzer for a project.
# Useful for testing that observation -> instinct pipeline works end-to-end.
#
# Usage:
#   ./scripts/run-analyzer.sh                  # interactive project picker
#   ./scripts/run-analyzer.sh <project-id>     # run for a specific project
#   ./scripts/run-analyzer.sh --list           # list known projects
#   ./scripts/run-analyzer.sh --dry-run [id]   # show what would run without executing
#
# Prerequisites:
#   - pi CLI installed and authenticated (~/.pi/agent/auth.json)
#   - At least one project with observations recorded
#
# The script:
#   1. Locates the project's observations and instincts directory
#   2. Generates the system prompt to a temp file
#   3. Builds the user prompt with the last 500 observations inlined
#   4. Spawns `pi` with the same flags the extension uses
#
set -euo pipefail

BASE_DIR="${HOME}/.pi/continuous-learning"
REGISTRY="${BASE_DIR}/projects.json"
MAX_TAIL_ENTRIES=500
MODEL="${PI_CL_MODEL:-claude-haiku-4-5}"

# --- helpers ----------------------------------------------------------------

die() { echo "error: $*" >&2; exit 1; }

check_prerequisites() {
  command -v pi >/dev/null 2>&1 || die "pi CLI not found in PATH"
  command -v jq >/dev/null 2>&1 || die "jq is required (brew install jq)"
  [[ -f "$REGISTRY" ]] || die "No projects registry found at ${REGISTRY}. Has the extension run at least once?"
}

list_projects() {
  echo "Known projects:"
  echo ""
  jq -r 'to_entries[] | "  \(.key)  \(.value.name // "(unnamed)")"' "$REGISTRY"
}

pick_project() {
  local count
  count=$(jq 'length' "$REGISTRY")
  if [[ "$count" -eq 0 ]]; then
    die "No projects in registry"
  elif [[ "$count" -eq 1 ]]; then
    jq -r 'keys[0]' "$REGISTRY"
  else
    echo "Multiple projects found. Pick one:" >&2
    echo "" >&2
    local i=1
    local ids=()
    while IFS= read -r line; do
      ids+=("$line")
      local name
      name=$(jq -r --arg id "$line" '.[$id].name // "(unnamed)"' "$REGISTRY")
      echo "  ${i}) ${line}  ${name}" >&2
      ((i++))
    done < <(jq -r 'keys[]' "$REGISTRY")
    echo "" >&2
    read -rp "Enter number: " choice
    local idx=$((choice - 1))
    [[ $idx -ge 0 && $idx -lt ${#ids[@]} ]] || die "Invalid selection"
    echo "${ids[$idx]}"
  fi
}

validate_project() {
  local project_id="$1"
  local project_dir="${BASE_DIR}/projects/${project_id}"
  [[ -d "$project_dir" ]] || die "Project directory not found: ${project_dir}"

  local obs_path="${project_dir}/observations.jsonl"
  if [[ ! -f "$obs_path" ]]; then
    die "No observations file at ${obs_path}"
  fi

  local line_count
  line_count=$(wc -l < "$obs_path" | tr -d ' ')
  if [[ "$line_count" -eq 0 ]]; then
    die "Observations file is empty (0 lines)"
  fi

  echo "Found ${line_count} observation(s) for project ${project_id}" >&2
}

get_project_name() {
  local project_id="$1"
  jq -r --arg id "$project_id" '.[$id].name // "unknown"' "$REGISTRY"
}

# --- system prompt generation -----------------------------------------------

generate_system_prompt() {
  cat <<'SYSTEM_PROMPT'
You are a coding behavior analyst. Your job is to read session observations
and produce or update instinct files that capture reusable coding patterns.

## Instinct File Format

Each instinct is a Markdown file with YAML frontmatter. The filename is `<id>.md`.

```
---
id: kebab-case-identifier
title: Short human-readable title
trigger: "When X happens / user asks about Y / tool Z is called"
confidence: 0.5
domain: typescript | git | testing | workflow | general
source: personal
scope: project | global
project_id: abc123def456  # omit for global instincts
project_name: my-project  # omit for global instincts
created_at: "2026-01-01T00:00:00.000Z"
updated_at: "2026-01-01T00:00:00.000Z"
observation_count: 5
confirmed_count: 2
contradicted_count: 0
inactive_count: 1
evidence:
  - "Brief note about a supporting observation"
---

The action text: what the agent should do when the trigger fires.
Keep this concise and actionable. No code snippets.
```

Rules for IDs:
- Lowercase letters and hyphens only (kebab-case)
- No numbers, underscores, or special characters
- Examples: use-read-before-edit, prefer-atomic-commits

## Pattern Detection Heuristics

Analyze observations for these categories:

### User Corrections
- User rephrases a request immediately after an agent response
- User explicitly rejects an approach ("no, don't do that", "that's wrong")
- User adds clarification after seeing agent output
- Trigger: the corrected behavior; Action: the preferred approach

### Error Resolutions
- Tool call returns is_error: true followed by a successful retry with different parameters
- Recurring error patterns resolved by a consistent fix
- Trigger: the error condition; Action: the proven resolution

### Repeated Workflows
- The same sequence of tool calls appears 3+ times across sessions
- User repeats the same type of prompt across sessions
- Trigger: the workflow start condition; Action: the efficient path

### Tool Preferences
- Agent consistently uses one tool over alternatives for similar tasks
- Certain tool parameters are always set the same way
- Trigger: the task type; Action: the preferred tool and parameters

### Anti-Patterns
- Actions that consistently lead to errors or user corrections
- Trigger: the situation that triggers the bad pattern; Action: what to do instead

## Feedback Analysis Instructions

Each observation may include an `active_instincts` field listing instinct IDs
that were injected into the agent's system prompt before that turn.

Use this field to update existing instinct confidence scores:

### Confirmed (confidence +0.05)
An instinct was active and the subsequent tool calls or agent behavior align
with the instinct's action. The agent followed the guidance without correction.
Set: increment `confirmed_count` by 1.

### Contradicted (confidence -0.15)
An instinct was active but the user corrected the agent, or the agent's behavior
directly conflicts with the instinct's action. The guidance was wrong or harmful.
Set: increment `contradicted_count` by 1.

### Inactive (confidence 0)
An instinct was injected but the trigger condition never arose in that turn,
so there is no signal either way.
Set: increment `inactive_count` by 1.

When updating an instinct file, recalculate confidence using the feedback rules
in the Confidence Scoring section below. Always update `updated_at` to now.

## Confidence Scoring Rules

### Discovery-Based Initial Confidence
Use observation_count to set the starting confidence for new instincts:
- 1-2 observations  -> 0.3
- 3-5 observations  -> 0.5
- 6-10 observations -> 0.7
- 11+ observations  -> 0.85

### Feedback Adjustments (applied to existing instincts)
- confirmed:    current + 0.05
- contradicted: current - 0.15
- inactive:     no change

### Passive Decay
- For each week since `updated_at`, subtract 0.02 from confidence.
- Apply decay before feedback adjustments.

### Clamping
- Confidence is always clamped to the range [0.1, 0.9].
- If the pre-clamp value falls below 0.1, set `flagged_for_removal: true`.

## Scope Decision Guide

Choose between project scope and global scope:

### Use project scope when:
- The pattern is specific to this project's tech stack, conventions, or structure
- The trigger references project-specific file paths, module names, or team workflows
- The pattern would be wrong or harmful in a different project context

### Use global scope when:
- The pattern applies to any coding session regardless of project
- The trigger is a universal task type (e.g., "before committing", "when editing a file")
- The pattern reflects a general best practice the user has demonstrated consistently

When in doubt, prefer project scope. Promote to global only when evidence is strong
(confidence >= 0.8, seen in multiple projects).

## Conservativeness Rules

These rules are non-negotiable:

1. **Minimum evidence**: Only create a new instinct when you have 3 or more clear,
   independent observations supporting the same pattern. Single observations are noise.

2. **No code snippets**: The action field must describe behavior in plain language.
   Never paste code, file contents, or command output into an instinct.

3. **One clear trigger**: Each instinct must have exactly one well-defined trigger.
   Vague triggers like "always" or "in general" are not allowed.

4. **Confidence cap**: New instincts created from observation data alone are capped
   at 0.85 regardless of observation count. Only feedback can approach 0.9.

5. **No duplication**: Before creating a new instinct, check existing instincts in
   the instincts directory. If a matching instinct exists, update it instead.

6. **Plain language only**: Write actions as clear instructions to an agent, not
   as rules, policies, or explanations. Start with a verb.

7. **Be skeptical of outliers**: A pattern seen only in error conditions or
   under unusual circumstances should not become an instinct.
SYSTEM_PROMPT
}

# --- user prompt generation -------------------------------------------------

build_user_prompt() {
  local project_id="$1"
  local project_name="$2"
  local obs_path="${BASE_DIR}/projects/${project_id}/observations.jsonl"
  local instincts_dir="${BASE_DIR}/projects/${project_id}/instincts/personal"

  local observations
  observations=$(tail -n "$MAX_TAIL_ENTRIES" "$obs_path")

  cat <<EOF
## Analysis Task

Analyze the following session observations and update the instinct files accordingly.

## Project Context

project_id: ${project_id}
project_name: ${project_name}

## File Paths

Observations file: ${obs_path}
Instincts directory: ${instincts_dir}

The following observations are the most recent entries (up to ${MAX_TAIL_ENTRIES}):

\`\`\`
${observations}
\`\`\`

## Instructions

1. Read existing instinct files from the instincts directory.
2. Analyze the observations above for patterns following the system prompt rules.
3. Create new instinct files or update existing ones in the instincts directory.
4. Apply feedback analysis using the active_instincts field in each observation.
5. Apply passive confidence decay to existing instincts before updating.
6. Do not delete any instinct files - only create or update.
EOF
}

# --- main -------------------------------------------------------------------

main() {
  local dry_run=false
  local project_id=""

  # Parse args
  case "${1:-}" in
    --list)
      check_prerequisites
      list_projects
      exit 0
      ;;
    --dry-run)
      dry_run=true
      project_id="${2:-}"
      ;;
    --help|-h)
      head -17 "$0" | tail -14
      exit 0
      ;;
    *)
      project_id="${1:-}"
      ;;
  esac

  check_prerequisites

  # Resolve project
  if [[ -z "$project_id" ]]; then
    project_id=$(pick_project)
  fi

  validate_project "$project_id"

  local project_name
  project_name=$(get_project_name "$project_id")
  echo "Project: ${project_name} (${project_id})" >&2

  # Write system prompt to temp file
  local tmp_dir=""
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' EXIT

  local system_prompt_file="${tmp_dir}/system-prompt.txt"
  generate_system_prompt > "$system_prompt_file"

  # Build user prompt
  local user_prompt
  user_prompt=$(build_user_prompt "$project_id" "$project_name")

  if $dry_run; then
    echo ""
    echo "=== DRY RUN ==="
    echo ""
    echo "Model: ${MODEL}"
    echo "System prompt: ${system_prompt_file} ($(wc -c < "$system_prompt_file" | tr -d ' ') bytes)"
    echo "User prompt: $(echo "$user_prompt" | wc -c | tr -d ' ') bytes"
    echo "Observations: $(tail -n "$MAX_TAIL_ENTRIES" "${BASE_DIR}/projects/${project_id}/observations.jsonl" | wc -l | tr -d ' ') lines"
    echo ""
    echo "Would run:"
    echo "  pi --mode json -p --no-session \\"
    echo "    --tools read,write \\"
    echo "    --no-extensions --no-skills --no-prompt-templates --no-themes \\"
    echo "    --model ${MODEL} \\"
    echo "    --append-system-prompt ${system_prompt_file} \\"
    echo "    \"<user prompt>\""
    exit 0
  fi

  echo "Starting analyzer..." >&2
  echo "" >&2

  pi --mode json -p --no-session \
    --tools read,write \
    --no-extensions --no-skills --no-prompt-templates --no-themes \
    --model "$MODEL" \
    --append-system-prompt "$system_prompt_file" \
    "$user_prompt"
}

main "$@"
