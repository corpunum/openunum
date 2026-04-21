# OpenUnum README Summary

## What is OpenUnum?
OpenUnum is an Ubuntu-first autonomous assistant framework focused on high tool reliability, strict model control, and agent-operated workflows.

## Key Features
- **Multi-provider support**: Works with OpenAI, Anthropic, Google, Groq, Ollama, and more
- **Tool-native execution**: Built-in tools for shell, files, browser, email, desktop, and skills
- **Mission system**: Proof-aware task completion with retries and verification
- **Safety controls**: Owner control modes (safe/locked/unlocked) for operation safety
- **Web UI**: Browser-based interface at http://localhost:3777

## Architecture
- **Controller loop**: `src/core/agent.mjs` manages the agent execution
- **Missions**: `src/core/missions.mjs` handles proof-aware completion
- **Tools**: `src/tools/runtime.mjs` executes tools with safety bounds
- **Providers**: `src/providers/*` contains transport contracts for various LLMs

## Configuration
- Runtime config: `~/.openunum/config.json`
- Provider credentials stored locally
- Model selection via provider/model format (e.g., `openai/gpt-4o`)

## API Endpoints
- `GET /api/health` - Health check
- `GET /api/config` - Current configuration
- `POST /api/auth/prefill-local` - Rescan/import provider credentials

## Running OpenUnum
```bash
npm start          # Start the server
npm run dev        # Development mode with auto-reload
```

## Key Concepts
- **Tool evidence**: Actions require tool results as proof of completion
- **Bounded execution**: Tools have safety limits and timeouts
- **Session persistence**: Chat sessions stored for context continuity
- **Skill system**: Installable local skills for extended functionality