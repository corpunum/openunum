# OpenUnum Autonomous Features Guide

## Overview

OpenUnum is now a fully autonomous AI assistant with self-healing, self-testing, and self-improvement capabilities.

## Core Autonomous Features

### 1. Self-Healing System

**Endpoints:**
- `GET /api/health` - Full health check
- `GET /api/self-heal?dryRun=true` - Check issues without fixing
- `POST /api/self-heal/fix` - Auto-fix all detected issues

**What it monitors:**
- Config integrity
- Disk space (< 90% usage)
- Memory store functionality
- Browser CDP connectivity
- Provider connectivity
- Log file writeability
- Skills directory

**Auto-recovery actions:**
- Rebuild corrupted config
- Reload agent tools after config fix
- Alert on browser CDP issues
- Warn on disk space critical

### 2. Self-Testing Framework

**Run tests:**
```bash
pnpm test:self        # Run comprehensive self-tests
pnpm test:health      # Quick health check tests
pnpm test:all         # All tests including E2E
```

**Test categories:**
- Config validation
- Memory operations
- Tool execution
- Provider connectivity
- Browser operations
- File I/O
- Shell commands

### 3. Auto-Improvement System

**Features:**
- Learns from successful tool runs
- Records strategy outcomes
- Suggests config optimizations
- Tracks performance metrics
- Auto-generates skills from patterns

**Endpoints:**
- `GET /api/auto-improve/status` - Check improvement status
- `POST /api/auto-improve/analyze` - Analyze recent operations
- `POST /api/auto-improve/optimize` - Apply optimizations

### 4. Skill Learning

The system automatically:
- Records successful operation patterns
- Creates skills from repeated successes
- Retrieves relevant skills for similar tasks
- Improves over time with usage

**Skill storage:** `~/.openunum/skills/`

### 5. Daemon Manager

Manages background processes:
- Auto-restart on crashes
- Health monitoring
- Resource limits
- Log rotation

**Commands:**
```bash
pnpm bootstrap start    # Start with daemon management
pnpm bootstrap stop     # Graceful shutdown
pnpm bootstrap restart  # Restart with health check
pnpm bootstrap status   # Check daemon status
```

## Autonomy Modes

### Standard Mode (default)
- Max tool iterations: 8
- Retry attempts: 3
- Mission step cap: 120
- Fallback providers enabled

### Relentless Mode
For maximum autonomy:
```bash
curl -X POST http://127.0.0.1:18880/api/autonomy/mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"relentless"}'
```

- Max tool iterations: 20
- Retry attempts: 6
- Mission step cap: 300
- Force primary provider (no fallback)

## API Quick Reference

### Health & Self-Heal
```bash
GET  /api/health              # Full health check
GET  /api/self-heal           # Self-heal check (dry run)
POST /api/self-heal/fix       # Apply all fixes
GET  /api/selfheal/status     # Self-heal monitor status
```

### Testing
```bash
GET  /api/self-test/run       # Run all self-tests
GET  /api/self-test/report    # Get test report
```

### Auto-Improvement
```bash
GET  /api/auto-improve/status     # Get improvement status
POST /api/auto-improve/analyze    # Analyze operations
POST /api/auto-improve/optimize   # Apply optimizations
```

### Configuration
```bash
GET  /api/config              # Get full config
POST /api/config              # Update config
GET  /api/autonomy/mode       # Get autonomy mode
POST /api/autonomy/mode       # Set autonomy mode
```

### Missions
```bash
GET  /api/missions            # List all missions
POST /api/missions/start      # Start new mission
POST /api/missions/stop       # Stop a mission
GET  /api/missions/status?id= # Get mission status
```

## Self-Healing Workflow

1. **Detection**: Health checks run every 60 seconds
2. **Analysis**: Failed checks increment consecutive failure counter
3. **Recovery**: Auto-heal triggers after 3 consecutive failures
4. **Verification**: Post-recovery health check confirms fix
5. **Learning**: Failed patterns recorded for future prevention

## Best Practices

### For Maximum Autonomy:
1. Enable relentless mode for complex tasks
2. Run `pnpm test:self` after any code changes
3. Monitor `/api/health` endpoint regularly
4. Review `/api/auto-improve/status` weekly

### For Development:
1. Always test with `pnpm test:self` before deploying
2. Use dry-run for self-heal: `/api/self-heal?dryRun=true`
3. Check mission logs for failure patterns
4. Review skill files in `~/.openunum/skills/`

## File Structure

```
~/.openunum/
├── openunum.json          # Runtime config
├── openunum.db            # SQLite memory store
├── logs/                  # Auto-rotated logs
├── skills/                # Learned skills
└── tests/                 # Test results cache

~/openunum/
├── src/
│   ├── core/
│   │   ├── agent.mjs          # Main agent logic
│   │   ├── selfheal.mjs       # Self-healing monitor
│   │   ├── self-test.mjs      # Self-testing framework
│   │   ├── auto-improve.mjs   # Auto-improvement engine
│   │   ├── daemon-manager.mjs # Process management
│   │   ├── skill-learner.mjs  # Skill learning system
│   │   └── missions.mjs       # Autonomous missions
│   ├── tools/
│   │   └── runtime.mjs        # Tool execution
│   ├── memory/
│   │   └── store.mjs          # SQLite memory
│   └── server.mjs             # HTTP API server
├── tests/
│   └── self-test-runner.mjs   # Test runner
├── bootstrap.mjs              # Bootstrap script
└── package.json               # Project config
```

## Troubleshooting

### Server won't start
```bash
pnpm bootstrap restart
```

### Tests failing
```bash
pnpm test:self  # Check which tests fail
curl http://127.0.0.1:18880/api/health  # Check system health
```

### Browser issues
```bash
curl -X POST http://127.0.0.1:18880/api/browser/launch
```

### Config corrupted
```bash
curl -X POST http://127.0.0.1:18880/api/self-heal/fix
```

## Next Steps for Self-Improvement

The system is designed to evolve. Future enhancements:
- [ ] Auto-generate new tools from successful patterns
- [ ] Predictive failure detection
- [ ] Cross-session learning
- [ ] Performance benchmarking
- [ ] Auto-scaling resource allocation

---

**Remember**: OpenUnum is your autonomous house. It can fix itself, test itself, and improve itself. Trust the system, but always verify critical changes.
