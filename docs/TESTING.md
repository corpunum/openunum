# OpenUnum Testing Guide

Comprehensive testing documentation for the OpenUnum project.

## Test Suites

| Suite | Command | Description |
|-------|---------|-------------|
| **Lint** | `pnpm lint` | Syntax-parse all tracked JS/MJS under `src/`, `scripts/`, `tests/` |
| **Format Check** | `pnpm format:check` | Enforce LF line endings + trailing newline in tracked in-scope text files |
| **Unit** | `pnpm test:unit` | Fast, isolated unit tests via Vitest |
| **E2E (Phase Battery)** | `pnpm e2e` | Canonical end-to-end phase battery (phase0..phase50) |
| **E2E (Node Suite)** | `pnpm test:e2e` | Node test-runner suite for `tests/e2e/*` |
| **Smoke (Isolated)** | `pnpm test:smoke` | Quick API health checks on a temporary local server |
| **Smoke (Live Service)** | `pnpm test:smoke:live` | Quick API health checks against the currently running service |
| **Session Imitation** | `pnpm test:imitation` | Replays chat-session recovery patterns against self-monitor continuation logic |
| **Docs Gate** | `pnpm docs:gate` | Fails when code changed without documentation updates |
| **Docs Index Freshness** | `pnpm docs:index:check` | Fails when `docs/SELF_READING_INDEX.md` is stale vs generator output |
| **Compact Profile Gate** | `pnpm gate:compact-profile` | Enforces `phase0:check` when compact-profile/4B-sensitive surfaces changed |
| **Packet Budget Gate** | `pnpm gate:packet-budget` | Fails when runtime/context packet budgets exceed configured limits |
| **API Reference Parity Gate** | `pnpm gate:api-reference-parity` | Fails when endpoints documented in `docs/API_REFERENCE.md` are not implemented by active runtime route conditions |
| **Runtime Surface Contract Gate** | `pnpm gate:runtime-surface-contract` | Fails when new server API literals are missing from `docs/API_REFERENCE.md` |
| **Route Wiring Gate** | `pnpm gate:route-wiring` | Fails when any `src/server/routes/*.mjs` module is not both imported and invoked by `src/server.mjs` |
| **UI Surface Gate** | `pnpm gate:ui-surface` | Fails when active UI file set under `src/ui/` diverges from canonical modular set (`index.html`, `styles.css`, `app.js`) |
| **WebUI Browser E2E** | `pnpm phase39:e2e` | Real browser interaction checks for Provider Vault modal/actions and Missions create/load/stop wiring |
| **Origin Guard E2E** | `pnpm phase40:e2e` | Verifies same-origin loopback + request-marker protection on browser mutating control-plane requests |
| **CLI Operator E2E** | `pnpm phase41:e2e` | Verifies CLI runtime/providers/auth/missions/sessions API-bridge commands against a live test server |
| **WebUI Routing/Auth E2E** | `pnpm phase42:e2e` | Browser interaction regression for model-routing save flow and service-vault modal/save wiring |
| **UI Static Assets E2E** | `pnpm phase43:e2e` | Verifies modular UI asset serving (`/ui/styles.css`, `/ui/app.js`) and 404 behavior for missing assets |
| **WebUI Vault/Mission Details E2E** | `pnpm phase44:e2e` | Browser regression for provider-vault modal test/save actions and mission timeline filter/search rendering |
| **Deterministic Fast-Path E2E** | `pnpm phase48:e2e` | Verifies short-turn deterministic fast-path trace flags on `/api/chat` |
| **Pending Completion Handoff E2E** | `pnpm phase49:e2e` | Verifies long-turn pending flow returns completed payload (`completed: true`) and persists final assistant reply |
| **Tooling Rollout WebUI E2E** | `pnpm phase50:e2e` | Browser regression for Settings -> Tooling and Skills runtime save + inventory wiring |
| **Verify (Canonical)** | `pnpm verify` | Canonical pre-merge/pre-deploy validation battery |
| **All (alias)** | `pnpm test:all` | Alias to `pnpm verify` |

## Quick Start

```bash
# Run all tests before deployment
pnpm deploy:gate

# Run canonical phase E2E battery
pnpm e2e

# Run smoke tests only (fastest)
pnpm test:smoke
```

## What Each Suite Covers

### Unit Tests (`pnpm test:unit`)

Fast, isolated tests for individual modules:

- **Memory Store** - CRUD operations, indexing, search, decay calculations
- **Verifier** - Quality scoring, safety checks, approval logic
- **Audit Logger** - Chain creation, hash verification, export formatting
- **ODD Enforcement** - Mode transitions, threshold checks, escalation logic
- **Utilities** - Helper functions, parsers, formatters

**Location:** `tests/unit/`  
**Framework:** Vitest  
**Expected Duration:** < 30 seconds

### E2E Tests (`pnpm test:e2e`)

End-to-end tests validating complete system workflows:

| Test File | Coverage |
|-----------|----------|
| `freshness-decay.e2e.mjs` | Memory half-life, staleness detection, freshness scoring, refresh endpoint |
| `hippocampal-replay.e2e.mjs` | Replay triggers, consolidation states, retrieval boosts, loop prevention, auto-consolidation |
| `verifier.e2e.mjs` | Verifier API contract, state-change verification, tool-result verification |
| `audit-logging.e2e.mjs` | Chain integrity, trace reconstruction, tamper detection, export formats, privacy hashing |
| `odd-enforcement.e2e.mjs` | ODD definitions, mode enforcement, confidence thresholds, escalation paths, mode transitions |
| `autonomy-master-recovery.e2e.mjs` | Autonomy master cycle returns health + recovery contract on degraded runtime |
| `runtime-wiring-routes.test.mjs` | Route-level runtime contract wiring for mission/session responses |

**Location:** `tests/e2e/`  
**Framework:** Node.js native test runner (`node --test`)  
**Requirements:** Tests self-start a local OpenUnum server via `tests/_helpers.mjs`  
**Expected Duration:** 2-5 minutes

### Smoke Tests (`pnpm test:smoke`)

Quick health checks for API endpoints:

| Script | Endpoints Tested |
|--------|------------------|
| `smoke-check.mjs` | Basic server health |
| `smoke-audit.mjs` | `/api/audit/stats`, `/api/audit/log` |
| `smoke-verifier.mjs` | `/api/verifier/stats`, `/api/verifier/check` |
| `smoke-memory.mjs` | `/api/memory/freshness`, `/api/memory/stale`, `/api/memory/refresh/:id` |
| `smoke-chat-stream.mjs` | `/api/chat/stream` SSE contract (`sessionId`, `pending`, `toolRuns`, `messages`) |
| `smoke-roles-approvals.mjs` | `/api/roles`, `/api/approvals/*` lifecycle (`request`, `pending`, `approve`, `stats`) |

**Location:** `scripts/*.mjs`  
**Framework:** Custom Node.js scripts  
**Requirements:** None (this command self-starts an isolated server on a temporary OpenUnum home)  
**Expected Duration:** < 30 seconds  
**Exit Code:** 0 = all passed, 1 = failures detected

### Live Service Smoke (`pnpm test:smoke:live`)

Use this only when you explicitly want to validate the currently running deployment instance.

- Reads `OPENUNUM_API_URL` (default `http://127.0.0.1:18880`)
- Uses current runtime config and can fail if the service is stale or not reachable

### Phase E2E Battery

Phased E2E tests are part of the canonical runtime/browser validation battery:

```bash
pnpm phase0:e2e    # Phase 0 tests
pnpm phase1:e2e    # Phase 1 tests
# ... through phase48
```

**Location:** `tests/phase*.e2e.mjs`  
**Policy:** Keep adding runtime contract checks in `tests/e2e/*`; add phased tests for full-flow regressions that require startup/browser or cross-surface coverage.

## Running Tests

### Prerequisites

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the API server** (for live smoke only):
   ```bash
   npm start
   ```

3. **Set environment variables** (optional):
   ```bash
   export OPENUNUM_API_URL=http://127.0.0.1:18880
   export NODE_ENV=test
   ```

### Test Commands

```bash
# Canonical gate (same as deploy gate)
pnpm verify

# Specific suites
pnpm lint
pnpm format:check
pnpm test:unit
pnpm test:e2e
pnpm e2e
pnpm phase39:e2e
pnpm phase40:e2e
pnpm phase41:e2e
pnpm phase42:e2e
pnpm phase43:e2e
pnpm phase44:e2e
pnpm phase49:e2e
pnpm phase50:e2e
pnpm test:smoke
pnpm test:smoke:live
pnpm test:imitation
pnpm docs:index:check
pnpm gate:compact-profile
pnpm gate:packet-budget
pnpm gate:api-reference-parity
pnpm gate:runtime-surface-contract
pnpm gate:route-wiring
pnpm gate:ui-surface

# Individual E2E test file
node --test tests/e2e/verifier.e2e.mjs

# Individual smoke test
node scripts/smoke-audit.mjs
```

### Deployment Gate

Before any deployment, run:

```bash
pnpm deploy:gate
```

This runs `pnpm verify` and outputs `✅ Deployment gate passed` on success.

## Writing New Tests

### E2E Test Structure

```javascript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

describe('Feature Name', () => {
  let testResourceId;

  before(async () => {
    // Setup: Create test resources
  });

  after(async () => {
    // Cleanup: Remove test resources
  });

  describe('Sub-feature', () => {
    it('should do something', async () => {
      const response = await fetch('http://127.0.0.1:18880/api/endpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true })
      });
      const result = await response.json();
      
      assert.strictEqual(result.success, true);
    });
  });
});
```

### Smoke Test Structure

```javascript
#!/usr/bin/env node

const API_BASE = process.env.OPENUNUM_API_URL || 'http://127.0.0.1:18880';

async function smokeTest() {
  console.log('🔍 Feature API Smoke Test');
  
  let passed = 0;
  let failed = 0;
  
  // Test endpoints...
  
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

smokeTest();
```

## Test Configuration

### Timeout Settings

- **Unit tests:** 5s default (Vitest)
- **E2E tests:** 30s per test
- **Smoke tests:** 30s total

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENUNUM_API_URL` | `http://127.0.0.1:18880` | API server URL |
| `NODE_ENV` | `development` | Environment mode |
| `TEST_VERBOSE` | `false` | Enable verbose output |

### Browser E2E Prerequisite

Install Chromium for Playwright once per machine:

```bash
pnpm exec playwright install chromium
```

## Troubleshooting

### Common Issues

**"Cannot connect to API"**
- Ensure server is running: `npm start`
- Check URL: `echo $OPENUNUM_API_URL`

**"Test timeout"**
- Increase timeout in test file
- Check for hanging promises or unclosed connections

**"Module not found"**
- Run `npm install` to ensure dependencies are installed
- Check that test files use `.mjs` extension

### Debug Mode

Run tests with verbose output:

```bash
NODE_ENV=test TEST_VERBOSE=true pnpm test:e2e
```

## Continuous Integration

Tests are designed to run in CI environments:

- Exit code 0 = success, 1 = failure
- Output is machine-parseable JSON where applicable
- Smoke tests provide quick feedback (< 30s)
- Full suite for pre-deployment validation

## Coverage

For code coverage reports (when configured):

```bash
pnpm test:unit -- --coverage
```

---

**Last Updated:** 2026-04-08  
**Maintainer:** OpenUnum Team
