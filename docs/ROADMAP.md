# Next Tasks

Context: the previous durability/policy tranche is done. Workers persist across restart, self-edit runs persist with promotion gates, planner policies cover more intent classes, and the controller now has a deterministic final-answer fallback when tools succeed but the model stays silent.

## 1. Core Principles Implementation

Goal:
- Fully implement the 9 core principles outlined in BRAIN.MD
- Ensure all agents follow framework-oriented, autonomy-first approach

Priority items:
- Integrate BRAIN.MD into agent onboarding
- Create self-modification capabilities following all principles
- Implement test-first deployment with comprehensive validation

Why:
- Establish clear operating guidelines for all AI agents
- Ensure consistent behavior across different models and use cases

Deliverables:
- BRAIN.MD with 9 core principles
- Updated agent onboarding documentation
- Self-modification framework with principle enforcement

## 2. Fix Dataset Research Trigger Issue

Goal:
- Prevent false positives with "usable" keyword triggering dataset research
- Ensure relevant responses only when actually asking about datasets

Priority items:
- Narrow regex patterns in extractRequirements function
- Test various user inputs to prevent irrelevant responses
- Validate fix with Telegram channel testing

Why:
- Current implementation causes confusion with irrelevant responses
- Maintains framework orientation without specific dataset bias

Deliverables:
- Fixed regex patterns in turn-recovery-summary.mjs
- Updated unit tests for requirement extraction
- Verified fix in Telegram channel

## 3. Enhanced Self-Healing Capabilities

Goal:
- Improve automatic error detection and recovery
- Add rollback mechanisms for failed operations

Priority items:
- Implement rollback capabilities for system operations
- Add automatic error detection and recovery patterns
- Create system integrity monitoring

Why:
- Self-healing is a core principle that needs strengthening
- Automatic recovery reduces user intervention requirements

Deliverables:
- Rollback mechanism implementation
- Error detection and recovery patterns
- System integrity monitoring system

## 4. Secrets At Rest With A Real Threat Model

Goal:
- replace plaintext `~/.openunum/secrets.json` storage with an explicit OS-keychain or passphrase-backed option

Why:
- mode `0600` is necessary but not sufficient
- machine-derived-key encryption is weak and should be avoided

Deliverables:
- pluggable secret backend
- migration path from current JSON store
- operator docs for backup/restore and headless usage

Progress (2026-04-08):
- Added passphrase-backed encrypted secret backend (`OPENUNUM_SECRETS_BACKEND=passphrase`) using AES-256-GCM + scrypt.
- Added compatibility migration path (`secrets.json` -> `secrets.enc.json`) on save when passphrase backend is enabled.
- Added auth catalog visibility for backend/lock state.

## 5. Consolidate Self-Heal Surfaces

Goal:
- reduce `selfheal.mjs`, `self-heal.mjs`, and `auto-recover.mjs` into one clear runtime path

Why:
- the overlap makes autonomous self-editing harder
- operational ownership is unclear

Deliverables:
- one canonical self-heal module
- legacy compatibility shims only where needed
- tests for the chosen surface

Progress (2026-04-08):
- Added canonical control-plane path `src/core/self-heal-orchestrator.mjs`.
- `/api/self-heal*` + `/api/health` now route through the orchestrator in `src/server.mjs`.
- Legacy modules remain for compatibility (`selfheal.mjs`, `self-heal.mjs`, `auto-recover.mjs`) and are next in line for deprecation shims.

Role mode progress (2026-04-08):
- Added bounded role-mode router (`src/core/role-mode-router.mjs`) with explicit modes (`intent`, `execution`, `proof`, `repair`, `retrieval`) wired into turn system directives and trace metadata.

## 6. Production Hardening

Goal:
- make the host safer and easier to run unattended

Priority items:
- HTTP rate limiting
- deployment guide (`systemd`, Docker, backup/restore)
- repeatable local model benchmark runner with first-token latency and throughput

Why:
- these are the remaining operator-grade gaps after the autonomy framework pass

## 7. Training Surface Parity (Harvest from MimoUnum)

Goal:
- expose a first-class `training/*` API family in OpenUnum that turns real interaction traces into eval/train artifacts

Priority items:
- `training/report`, `training/collect`, `training/export`, `training/export/file`, `training/cycle`
- compact WebUI "Autonomy Scorecard" panel (health + quality + export quick-actions)
- explicit score-factor transparency in API responses

Why:
- this is the highest-ROI capability harvested from MimoUnum
- improves self-improvement workflow without weakening OpenUnum's stronger orchestration model

## Implementation Priority

Following the core principles:
1. **Safety First** - All changes must maintain system integrity
2. **User Service** - Enhance user experience and capabilities
3. **Autonomous Operation** - Reduce need for user intervention
4. **Framework Flexibility** - Support diverse use cases
5. **Continuous Improvement** - Learn and adapt over time

## Testing Protocol

Every change must follow this sequence:
1. Write/update unit tests
2. Run all existing tests to ensure no regressions
3. Update documentation
4. Run smoke tests
5. Deploy to staging
6. Run E2E tests
7. Deploy to production

## Core Principles Enforcement

All work must align with the 9 core principles in BRAIN.MD:
1. Framework Oriented
2. Autonomy First
3. Model Agnostic
4. Servant Relationship
5. Self Preservation
6. Self Healing
7. Test First
8. Continuous Updates
9. Self Modification
