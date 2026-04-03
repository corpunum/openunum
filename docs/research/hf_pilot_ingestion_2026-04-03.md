# HF Pilot Ingestion (2026-04-03)

- Selected datasets: 5
- Normalized trajectories: 52
- Samples with tool calls: 28
- Samples with plan text: 24
- Samples with final answer text: 0

## Selected datasets

- obaydata/mcp-agent-trajectory-benchmark (score=10.458, license=apache-2.0, downloads=597, likes=1)
- DataCreatorAI/tool-calling-browser-agent-tasks (score=8.791, license=cc-by-4.0, downloads=48, likes=1)
- agent-eto/eto-sft-trajectory (score=6.545, license=apache-2.0, downloads=203, likes=17)
- SultanR/arxiv-to-code-agentic-tool-calling (score=6.180, license=mit, downloads=23, likes=0)
- quotientai/limbic-eval-tool-use-mcp (score=6.001, license=mit, downloads=1035, likes=13)

## Ingestion status

- obaydata/mcp-agent-trajectory-benchmark: ok | split=default:train | fetched=24 | normalized=24
- DataCreatorAI/tool-calling-browser-agent-tasks: ok | split=default:train | fetched=24 | normalized=24
- agent-eto/eto-sft-trajectory: ok | split=default:webshop | fetched=24 | normalized=0
- SultanR/arxiv-to-code-agentic-tool-calling: ok | split=default:train | fetched=10 | normalized=4
- quotientai/limbic-eval-tool-use-mcp: ok | split=default:test | fetched=24 | normalized=0

## Output artifacts

- `data/hf-pilot/openunum_trajectory_pilot.jsonl`
- `data/hf-pilot/manifest.json`
