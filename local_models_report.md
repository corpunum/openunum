# Local Models Report

Date: 2026-04-03

## Hardware

- CPU: AMD Ryzen Z1 Extreme
- Threads: 16
- RAM: about 17 GiB
- GPU: no NVIDIA GPU detected

Conclusion:
- this box is a practical 4B to 9B local host
- 18B to 20B quants are stretch territory
- 27B+ is possible only as a slow experiment, not a comfortable default

## Current Top 5 Free Local Uncensored Candidates

These are the strongest current candidates for this machine class based on live Hugging Face availability, popularity signals, and practical fit for 17 GiB RAM.

1. `HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive`
2. `mradermacher/Llama3.3-8B-Instruct-Thinking-Heretic-Uncensored-Claude-4.5-Opus-High-Reasoning-i1-GGUF`
3. `HauhauCS/Qwen3.5-4B-Uncensored-HauhauCS-Aggressive`
4. `DavidAU/Llama-3.2-8X3B-MOE-Dark-Champion-Instruct-uncensored-abliterated-18.4B-GGUF`
5. `DavidAU/OpenAi-GPT-oss-20b-abliterated-uncensored-NEO-Imatrix-gguf`

Notes:
- items 1 to 3 are the practical fit group for this hardware
- items 4 and 5 are quality stretch options if you accept slower CPU-only inference

Sources:
- https://huggingface.co/HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive
- https://huggingface.co/mradermacher/Llama3.3-8B-Instruct-Thinking-Heretic-Uncensored-Claude-4.5-Opus-High-Reasoning-i1-GGUF
- https://huggingface.co/HauhauCS/Qwen3.5-4B-Uncensored-HauhauCS-Aggressive
- https://huggingface.co/DavidAU/Llama-3.2-8X3B-MOE-Dark-Champion-Instruct-uncensored-abliterated-18.4B-GGUF
- https://huggingface.co/DavidAU/OpenAi-GPT-oss-20b-abliterated-uncensored-NEO-Imatrix-gguf

## Installed Local Models

Installed via Ollama on this host:

| Model | Family | Params | Quant | Size |
|---|---|---:|---|---:|
| `qwen3.5-9b-uncensored-aggressive:latest` | qwen35 | 9.0B | Q6_K | 7.4 GB |
| `qwen3.5-9b-uncensored:latest` | qwen35 | 9.0B | Q6_K | 7.4 GB |
| `qwen3-hauhau-q6k:latest` | qwen35 | 9.0B | Q6_K | 7.4 GB |
| `qwen3.5-9b-uncensored-local:latest` | qwen35 | 9.0B | Q6_K | 7.4 GB |
| `uncensored:latest` | llama | 8.0B | Q4_0 | 4.7 GB |

## Local Benchmark

Prompt:
- `In one short paragraph, say what hardware this machine would need for comfortable local inference.`

Method:
- local Ollama `POST /api/generate`
- `stream=false`
- `num_predict=96`
- temperature `0.2`

Results:

| Model | Status | Total ms | Load ms | Eval tokens | Tokens/sec | Notes |
|---|---:|---:|---:|---:|---:|---|
| `uncensored:latest` | 200 | 14313 | 6519 | 75 | 11.87 | fastest installed uncensored model |
| `qwen3-hauhau-q6k:latest` | 200 | 17354 | 197 | 96 | 5.88 | best balanced installed Qwen variant |
| `qwen3.5-9b-uncensored-local:latest` | 200 | 17876 | 224 | 96 | 5.85 | similar to Hauhau Q6_K |
| `qwen3.5-9b-uncensored:latest` | 200 | 21863 | 4826 | 96 | 5.88 | good output, slower cold load |
| `qwen3.5-9b-uncensored-aggressive:latest` | 500 | - | - | - | - | broken local package: `Failed to create new sequence: no input provided` |

Interpretation:
- if you want maximum speed on this machine, `uncensored:latest` wins
- if you want better 9B-class reasoning while staying local, `qwen3-hauhau-q6k:latest` is the best current installed default
- `qwen3.5-9b-uncensored-aggressive:latest` should not be used until its packaging/prompt template issue is fixed

## Recommended Defaults For This Machine

1. Daily local uncensored default:
   - `qwen3-hauhau-q6k:latest`
2. Faster fallback:
   - `uncensored:latest`
3. Keep for comparison only:
   - `qwen3.5-9b-uncensored:latest`
   - `qwen3.5-9b-uncensored-local:latest`
4. Repair or remove:
   - `qwen3.5-9b-uncensored-aggressive:latest`

## Operational Follow-Up

- benchmark first-token latency separately, not just steady-state generation speed
- add a repeatable benchmark script to avoid ad hoc manual checks
- import one current 4B uncensored model for a true low-RAM comparison point
