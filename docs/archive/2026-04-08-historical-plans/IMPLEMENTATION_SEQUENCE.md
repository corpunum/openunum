# Implementation Sequence (Execution Order)

1. Scaffold project (`src/`, `tests/`, `config/`, `scripts/`).
2. Implement config + logger + health command.
3. Implement provider interface + Ollama provider.
4. Add OpenRouter + NVIDIA + generic OpenAI-compatible provider.
5. Build core session loop + hot-switch command.
6. Add file/shell tool runtime with policy controls.
7. Add CDP browser connector (`127.0.0.1:9222`) + managed fallback.
8. Add SQLite memory persistence + retrieval.
9. Add skills loader and validation.
10. Add Telegram and WhatsApp channel adapters.
11. Build minimal web/mobile UI.
12. Package as systemd user service and complete soak test.

Each step requires:
- unit tests for new module
- one integration test
- update to E2E script if behavior changes

