# Changelog

All notable changes to OpenUnum are documented in this file.

---

## [2.2.0] - 2026-04-05

### Added
- **Channel-Agnostic Command System** — Slash commands work identically across WebUI, Telegram, CLI, and any future channel
- **Command Parser** — Enhanced parser with flag support (`--dry-run`, `--key=value`) (`src/core/command-parser.mjs`)
- **Command Registry** — Central routing system for all commands (`src/commands/registry.mjs`)
- **Command Loader** — Auto-registers all builtin commands at startup (`src/commands/loader.mjs`)
- **11 Builtin Commands:**
  - `/help [command]` — Show available commands or details
  - `/status` — Current model, tokens, context usage
  - `/new` — Start fresh session
  - `/compact [--dry-run]` — Trigger context compaction
  - `/memory` — Show memory artifacts and compaction status
  - `/cost` — Token/cost estimate
  - `/ledger` — Strategy/tool reliability ledger
  - `/session list|clear|delete <id>` — Session management
  - `/rule add|list|remove|active [text]` — Persistent behavioral rules (max 10 active)
  - `/knowledge add|list|search|remove [text]` — Searchable knowledge base
  - `/skill list` — Skill management
- **Rules System** — Persistent constraints injected into every session (`data/rules/*.json`)
- **Knowledge Base** — Searchable knowledge entries with BM25-style matching (`data/knowledge/*.json`)
- **API Endpoints** — `POST /api/command`, `GET /api/commands`
- **CLI Integration** — `openunum command /status` for direct command execution
- **Unit Tests** — 19 tests covering parser, registry, and all builtin commands (`tests/unit/commands.test.mjs`)
- **Documentation** — Command system section added to Agent Onboarding guide

### Changed
- **Agent chat()** — Now routes through command registry before falling back to inline handler
- **Server startup** — Loads builtin commands at initialization

### Architecture
- Commands are standalone modules in `src/commands/builtin/`
- Registry uses singleton pattern for global access
- Parser is channel-agnostic (no UI/channel dependencies)
- Backward compatible — existing inline slash commands still work as fallback

---

## [2.1.0] - 2026-04-05

### Added
- **Hybrid Retrieval Pipeline** — BM25 + Embeddings + Rerank (`src/memory/embeddings.mjs`, `src/memory/recall.mjs`)
- **Context Compiler** — Ordered context assembly pipeline (`src/core/context-compiler.mjs`)
- **Enriched Compaction Artifacts** — Extracts verifiedFacts, openLoops, pendingSubgoals, failuresWithReasons, producedArtifacts (`src/core/context-compact.mjs`)
- **Proof Scorer v2** — Multi-factor scoring with verification depth + claim specificity (`src/core/proof-scorer.mjs`)
- **Documentation** — Architecture, Context Engineering, Memory System, Agent Onboarding guides

### Changed
- **Proof threshold raised** — 0.5 → 0.6 for "done" status
- **Output substance threshold** — 50 → 100 chars for substantial output
- **Compaction output** — Now includes `enrichedArtifacts` object

### Improved
- **Verification depth scoring** — Detects result interpretation, git verification, test confirmation
- **Claim specificity scoring** — Rewards concrete evidence (paths, hashes, counts), penalizes vague language
- **Memory retrieval** — Dual scoring (BM25 + similarity) for better relevance

### Fixed
- **Context drift prevention** — Working memory anchor now injected every turn
- **Artifact extraction** — Now captures verified facts, open loops, pending subgoals

---

## [2.0.0] - 2026-03-31

### Added
- **Modular architecture** — Separated config, agent, health, memory, tools, UI
- **Session management** — Multi-session chat with sidebar UI
- **Context compaction** — Summarization with artifact extraction
- **Tool runtime** — Argument generation, fallback handling
- **Autonomy throttling** — Prevents runaway tool loops
- **Execution trace** — Tool usage logging and audit trail
- **Working memory anchor** — Prevents drift in weak models
- **Self-healing system** — Monitors and recovers from failures

### Changed
- **Monolithic → Modular** — Split server.mjs into separate modules
- **LocalStorage → Backend persistence** — Sessions stored in `data/sessions/*.json`

### Fixed
- **Tool execution bug** — Fixed `args is not defined` error
- **UI menu/API** — Repaired config, health, git-status, memory endpoints
- **Browser automation** — Installed Playwright binaries for CDP

---

## [0.1.0] - 2026-03-30

### Added
- **Initial release** — Basic autonomous assistant
- **Tool support** — File, git, exec, browser, memory, web_search
- **Telegram channel** — Bot integration with offset persistence
- **UI server** — Basic web interface at localhost:18881
- **Config system** — JSON-based configuration

---

## Version History Summary

| Version | Date | Key Changes |
|---------|------|-------------|
| 2.2.0 | 2026-04-05 | Channel-agnostic command system, rules, knowledge base, CLI integration |
| 2.1.0 | 2026-04-05 | Hybrid retrieval, context compiler, enriched compaction, proof scorer v2 |
| 2.0.0 | 2026-03-31 | Modular architecture, session management, self-healing |
| 0.1.0 | 2026-03-30 | Initial release |

---

## Upcoming (Unreleased)

- [ ] Real debate/council behavior for LexiHedge integration
- [ ] Stronger legacy risk controls and trade lifecycle
- [ ] RAG-only mode for >64K context
- [ ] Model behavior registry learning from execution traces
- [ ] Autosync race condition fix with manual git workflows
