# OpenUnum Master Plan (Ubuntu)

## Goal
Ship a lightweight assistant that runs reliably on your Ubuntu machine and supports:
- `ollama`, `openrouter`, `nvidia` (+ generic OpenAI-compatible providers)
- hot model switching
- tool calling (files, shell, browser)
- memory (SQLite + optional vector index)
- skills
- WhatsApp + Telegram
- clean desktop/mobile web UI
- Chromium remote debugging on `127.0.0.1:9222`

## Non-Goals (v1)
- Multi-channel explosion (Slack/Discord/etc.)
- Native mobile apps
- Heavy plugin marketplaces
- Distributed/multi-node orchestration

## Delivery Strategy
Build from scratch in a clean repo with strict module boundaries. Keep core minimal; everything optional as adapters.

## Phase Plan

## Phase 0: Bootstrap + Guardrails
Deliverables:
- repo skeleton
- config schema + env loading
- structured logging + health endpoint
- systemd user service template

E2E Gate:
- `openunum --version`
- health endpoint returns `ok`
- systemd unit starts/stops cleanly

## Phase 1: Model Core + Chat Loop
Deliverables:
- unified model adapter interface
- providers: Ollama, OpenRouter, NVIDIA, generic OpenAI-compatible
- session runtime with hot-switch model command

E2E Gate:
- same prompt answered by Ollama and OpenRouter
- mid-session switch provider/model without restart

## Phase 2: Tool Runtime
Deliverables:
- tools: `file.read`, `file.write`, `file.patch`
- tools: `shell.run` with explicit approval policy
- tool timeout/budget/retry controls

E2E Gate:
- agent creates/edits/reads project files
- agent runs Ubuntu commands and returns output

## Phase 3: Browser + Remote Debugging
Deliverables:
- CDP connector to existing browser at `127.0.0.1:9222`
- managed Chromium fallback launcher
- tools: `browser.open`, `browser.click`, `browser.type`, `browser.snapshot`

E2E Gate:
- connect to CDP, navigate, extract page text
- fallback managed browser works if no CDP target

## Phase 4: Memory + Skills
Deliverables:
- SQLite conversation + events store
- optional vector memory (`sqlite-vec`) for retrieval
- local skills loader (`skills/<name>/SKILL.md` + manifest)

E2E Gate:
- recall prior facts across restart
- skill tool loads/unloads correctly

## Phase 5: Channels (WhatsApp + Telegram)
Deliverables:
- WhatsApp bridge (Baileys)
- Telegram bridge (grammY)
- inbound/outbound routing to same agent core

E2E Gate:
- send message via Telegram, receive grounded response
- send message via WhatsApp, receive response + tool output summary

## Phase 6: Web UI + Mobile Lite
Deliverables:
- web chat UI
- mobile-responsive lightweight view
- model switch + session inspector + tool trace

E2E Gate:
- desktop and mobile browser both usable
- can switch model and continue same session

## Phase 7: Hardening + Production Readiness
Deliverables:
- config migration + backup
- audit logs for dangerous tools
- crash recovery + service watchdog

E2E Gate:
- reboot machine and recover cleanly
- all previous phase tests pass in one script

## Operating Rules
- keep dependencies minimal and justified
- no hidden global state
- one responsibility per module
- every phase must pass E2E before moving on

## First Implementation Target
Phases 0-2 only, then run for 24 hours on your Ubuntu host before expanding.

