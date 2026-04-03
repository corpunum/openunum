# Next Tasks

Context: the previous durability/policy tranche is done. Workers persist across restart, self-edit runs persist with promotion gates, planner policies cover more intent classes, and the controller now has a deterministic final-answer fallback when tools succeed but the model stays silent.

## 1. Secrets At Rest With A Real Threat Model

Goal:
- replace plaintext `~/.openunum/secrets.json` storage with an explicit OS-keychain or passphrase-backed option

Why:
- mode `0600` is necessary but not sufficient
- machine-derived-key encryption is weak and should be avoided

Deliverables:
- pluggable secret backend
- migration path from current JSON store
- operator docs for backup/restore and headless usage

## 2. Consolidate Self-Heal Surfaces

Goal:
- reduce `selfheal.mjs`, `self-heal.mjs`, and `auto-recover.mjs` into one clear runtime path

Why:
- the overlap makes autonomous self-editing harder
- operational ownership is unclear

Deliverables:
- one canonical self-heal module
- legacy compatibility shims only where needed
- tests for the chosen surface

## 3. Production Hardening

Goal:
- make the host safer and easier to run unattended

Priority items:
- HTTP rate limiting
- deployment guide (`systemd`, Docker, backup/restore)
- repeatable local model benchmark runner with first-token latency and throughput

Why:
- these are the remaining operator-grade gaps after the autonomy framework pass
