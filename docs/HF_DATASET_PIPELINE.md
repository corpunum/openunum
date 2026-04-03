# HF Dataset Pipeline

Date: 2026-04-03

## Purpose

Provide a repeatable way to turn Hugging Face agent/tool/planner datasets into OpenUnum-ready trajectory samples for training and evaluation.

## Commands

```bash
pnpm hf:explore
pnpm hf:pilot
```

## Stage 1: Exploration

`pnpm hf:explore`:
- queries Hugging Face dataset search API across agent/tool/planner terms
- ranks candidates by relevance + quality + license signals
- writes:
  - `docs/research/hf_dataset_exploration_2026-04-03.json`
  - `docs/research/hf_dataset_exploration_2026-04-03.md`

## Stage 2: Pilot Ingestion

`pnpm hf:pilot`:
- selects top permissive-license datasets from exploration output
- fetches first rows via datasets-server API
- normalizes rows into one schema:
  - `goal`
  - `plan`
  - `tool_calls`
  - `observations`
  - `verification`
  - `final`
- writes:
  - `data/hf-pilot/openunum_trajectory_pilot.jsonl`
  - `data/hf-pilot/manifest.json`
  - `docs/research/hf_pilot_ingestion_2026-04-03.md`

## Runtime Impact

OpenUnum recovery synthesis now consumes local dataset knowledge from:
- `docs/research/hf_dataset_exploration_2026-04-03.json`
- `data/hf-pilot/manifest.json`

This improves dataset recommendation stability and ensures pilot-selected datasets are prioritized when users ask dataset/planner/tool-calling research questions.

## Safety

- this pipeline samples only first rows (no bulk dataset download)
- benchmark datasets should stay separate from training corpora
- permissive-license filtering is applied before pilot selection
