# Hugging Face Dataset Exploration (2026-04-03)

- Queries: 8
- Candidate set (deduped): 18
- HF token used: yes

## Top Candidates for OpenUnum Improvement

| Rank | Dataset | Score | Downloads | Likes | License | Why it matters |
| --- | --- | ---: | ---: | ---: | --- | --- |
| 1 | [obaydata/mcp-agent-trajectory-benchmark](https://huggingface.co/datasets/obaydata/mcp-agent-trajectory-benchmark) | 10.458 | 597 | 1 | apache-2.0 | agent trajectories, evaluation |
| 2 | [DataCreatorAI/tool-calling-browser-agent-tasks](https://huggingface.co/datasets/DataCreatorAI/tool-calling-browser-agent-tasks) | 8.791 | 48 | 1 | cc-by-4.0 | tool-calling, agent trajectories, planning/tasks |
| 3 | [agent-eto/eto-sft-trajectory](https://huggingface.co/datasets/agent-eto/eto-sft-trajectory) | 6.545 | 203 | 17 | apache-2.0 | agent trajectories |
| 4 | [SultanR/arxiv-to-code-agentic-tool-calling](https://huggingface.co/datasets/SultanR/arxiv-to-code-agentic-tool-calling) | 6.180 | 23 | 0 | mit | tool-calling, agent trajectories |
| 5 | [quotientai/limbic-eval-tool-use-mcp](https://huggingface.co/datasets/quotientai/limbic-eval-tool-use-mcp) | 6.001 | 1035 | 13 | mit | tool-calling, evaluation |
| 6 | [alwaysfurther/deepfabric-agent-tool-calling](https://huggingface.co/datasets/alwaysfurther/deepfabric-agent-tool-calling) | 5.616 | 51 | 0 | unknown | tool-calling, agent trajectories |
| 7 | [orlando23/failed_agent_trajectory](https://huggingface.co/datasets/orlando23/failed_agent_trajectory) | 4.806 | 66 | 0 | apache-2.0 | agent trajectories |
| 8 | [quotientai/mcp-tool-use-eval](https://huggingface.co/datasets/quotientai/mcp-tool-use-eval) | 4.799 | 24 | 1 | apache-2.0 | tool-calling, evaluation |
| 9 | [Weni/Function-Calling-Benchmark-1.1.0](https://huggingface.co/datasets/Weni/Function-Calling-Benchmark-1.1.0) | 4.791 | 30 | 0 | unknown | tool-calling, evaluation |
| 10 | [mlfoundations-cua-dev/agent-trajectory-data](https://huggingface.co/datasets/mlfoundations-cua-dev/agent-trajectory-data) | 4.695 | 205 | 1 | unknown | agent trajectories |
| 11 | [Weni/Function-Calling-Benchmark-1.0.0](https://huggingface.co/datasets/Weni/Function-Calling-Benchmark-1.0.0) | 4.145 | 6 | 0 | unknown | tool-calling, evaluation |
| 12 | [evelynhong/embodied_web_agent_outdoor_trajectory](https://huggingface.co/datasets/evelynhong/embodied_web_agent_outdoor_trajectory) | 4.106 | 13 | 0 | unknown | agent trajectories |
| 13 | [account4review/Agent-Trajectory-2.8k](https://huggingface.co/datasets/account4review/Agent-Trajectory-2.8k) | 4.021 | 10 | 0 | mit | agent trajectories |
| 14 | [rl-world/web-agent-trajectory-multimodal-test](https://huggingface.co/datasets/rl-world/web-agent-trajectory-multimodal-test) | 4.001 | 10 | 0 | unknown | agent trajectories |
| 15 | [rl-world/web-agent-trajectory-test](https://huggingface.co/datasets/rl-world/web-agent-trajectory-test) | 3.863 | 7 | 0 | unknown | agent trajectories |
| 16 | [MLexperiments/agent_trajectory_test](https://huggingface.co/datasets/MLexperiments/agent_trajectory_test) | 3.256 | 14 | 0 | unknown | agent trajectories |
| 17 | [James4Ever0/computer_agent_reinforcement_learning_trajectory_seagent_ai_assistant_tools_agent_mcp](https://huggingface.co/datasets/James4Ever0/computer_agent_reinforcement_learning_trajectory_seagent_ai_assistant_tools_agent_mcp) | 3.034 | 8 | 0 | unknown | tool-calling, agent trajectories |
| 18 | [rogue-security/mcp-tool-use-quality-benchmark](https://huggingface.co/datasets/rogue-security/mcp-tool-use-quality-benchmark) | 2.821 | 18 | 3 | unknown | tool-calling, evaluation |

## Recommended Ingestion Policy

1. Keep only permissive or clearly-usable licenses for training/eval.
2. Sample first, do not bulk-download entire corpora.
3. Normalize to one OpenUnum trajectory schema (`goal`, `plan`, `tool_calls`, `observations`, `verification`, `final`).
4. Separate train corpora from benchmark corpora to avoid leakage.
5. Gate inclusion by measurable gains on OpenUnum e2e mission completion and proof quality.

## Immediate Next Dataset Actions

1. Build a 5-dataset pilot set from top-ranked entries.
2. Create adapters for function-calling and planner trajectories.
3. Run small-model eval (`4B-9B`) vs cloud-model eval and compare improvement deltas.
