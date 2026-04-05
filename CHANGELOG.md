# Changelog

All notable changes to OpenUnum are documented in this file.

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
