# Skill Bundles (Forge, Load, Execute)

This document describes the OpenUnum skill-bundle lifecycle and when agents should use it.

## What Exists Today

OpenUnum includes an internal skill-bundle pipeline inspired by prior `unumskill` workflows, but implemented natively (no Base44 dependency).

Current tool surface:

- `skill_forge` (generate + install bundle)
- `skill_load` (load bundle rules into current session context)
- `skill_list`
- `skill_install`
- `skill_review`
- `skill_approve`
- `skill_execute`
- `skill_uninstall`

Core implementation:

- `src/skills/factory.mjs` (bundle generation)
- `src/skills/manager.mjs` (bundle install/load/execute lifecycle)
- `src/tools/runtime.mjs` (tool wiring)

## Tool vs Skill

- `skill_forge` is a **tool**.
- The output is a **skill bundle** (files + metadata) stored under local skills storage.
- A forged bundle becomes an installed skill that can be listed, loaded, and executed.

## Storage Layout

Default OpenUnum home:

- `~/.openunum/skills/manifest.json` (registry/metadata)
- `~/.openunum/skills/custom/<skill-name>/` (bundle directory)
  - `SKILL.md`
  - `_meta.json`
  - `knowledge.md`
  - `decision_tree.md`
  - `examples.md`
  - `execute.mjs`

## When Agents Should Use Skill Bundles

Use skill bundles when the task pattern is recurring and benefits from reusable deterministic guidance:

- repeated multi-step operational workflows
- consistent troubleshooting playbooks
- domain-specific execution policies that are reused across sessions

Do not forge a bundle for one-off trivial tasks.

## Recommended Agent Workflow

1. `skill_list` to check whether a suitable skill already exists.
2. If missing, run `skill_forge` with a concrete goal.
3. `skill_load` before execution-heavy turns that should follow the skill logic.
4. `skill_execute` when the bundle provides executable logic (`execute.mjs`).
5. `skill_review` / `skill_approve` for externally sourced or modified skills.

## Direct API Usage

OpenUnum exposes a direct tool execution endpoint:

- `POST /api/tool/run`

Forge example:

```json
{
  "name": "skill_forge",
  "args": {
    "goal": "Create an incident triage skill for API latency spikes",
    "research": true
  }
}
```

Load example:

```json
{
  "name": "skill_load",
  "args": {
    "name": "incident-triage-api-latency"
  }
}
```

Execute example:

```json
{
  "name": "skill_execute",
  "args": {
    "name": "incident-triage-api-latency",
    "args": {
      "service": "chat-api",
      "windowMinutes": 30
    }
  }
}
```

## Execution Envelope Notes

- Compact envelope is intentionally restrictive and typically does not include `skill_forge`.
- Balanced/full envelopes are expected for skill authoring workflows.
- If a tool is blocked in the current envelope, switch to an allowed model/profile tier first.

## Current Limitations

- `skill_forge` is available via tool runtime, not as a dedicated `/api/skills/forge` route.
- Bundle quality depends on model/provider quality and prompt context.
- `execute.mjs` safety still relies on review/approval discipline for non-trusted sources.
