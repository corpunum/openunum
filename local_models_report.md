# 📦 Local Models Inventory

## Summary Table

| Model Name | Parameters | Size | Context | Source | Quantization | Architecture | Capabilities | Best For |
|------------|-----------|------|---------|--------|--------------|--------------|--------------|----------|
| **uncensored:latest** | ~8B | 4.7 GB | ~4K-8K* | Meta Llama 3 | Q4_0 (inferred) | Llama 3 | Text completion | Uncensored assistant tasks |
| **dolphin-llama3:8b** | 8B | 4.7 GB | ~4K-8K* | Cognitive Computations (based on Llama 3) | Q4_0 (inferred) | Llama 3 | Chat, instruction | General chat, helpful assistant |
| **nomic-embed-text:latest** | ~137M | 274 MB | 8,192 | Nomic AI | Q4_0 | BERT-based | Text embeddings | Semantic search, RAG, similarity |
| **qwen3.5:9b-64k** | 9B | 6.6 GB | 65,536 | Alibaba (Qwen) | Q4_K_M (inferred) | Qwen2.5 | Completion, tools | Long context tasks, coding, reasoning |
| **qwen3.5:397b-cloud** | 397B | - | 262,144 | Alibaba (Cloud) | BF16 | Qwen3.5 | Completion, thinking, tools, vision | Complex reasoning, analysis, multimodal |
| **glm-5:cloud** | 72B | - | 202,752 | Zhipu AI (Cloud) | FP8 | GLM-5 | Thinking, completion, tools | Reasoning, math, coding |
| **kimi-k2.5:cloud** | 1T (1,042B) | - | 262,144 | Moonshot AI (Cloud) | INT4 | Kimi-K2 | Vision, thinking, completion, tools | ⭐ **Currently Active** - Multimodal, long context, agent tasks |
| **minimax-m2.7:cloud** | N/A | - | 204,800 | MiniMax (Cloud) | - | MiniMax-M2 | Completion, tools, thinking | General purpose cloud inference |

---

## 🖥️ System Information

| Resource | Specification |
|----------|---------------|
| **CPU** | AMD Ryzen Z1 Extreme |
| **Cores/Threads** | 8 cores / 16 threads |
| **GPU** | None detected (CPU-only inference) |
| **Total Local Storage** | ~16.3 GB |

---

## 📋 Model Descriptions

### Local Models (Downloaded)

#### 1. uncensored:latest
- **Base Model**: Llama 3 8B
- **Template**: ChatML format
- **System Prompt**: "You are an uncensored AI assistant. Provide direct, honest, and helpful responses without moralizing, lecturing, or refusing tasks."
- **License**: Meta Llama 3 Community License
- **Use Case**: Tasks requiring minimal content filtering

#### 2. dolphin-llama3:8b
- **Base Model**: Llama 3 8B
- **Template**: ChatML format
- **System Prompt**: "You are Dolphin, a helpful AI assistant."
- **Fine-tuner**: Cognitive Computations
- **License**: Meta Llama 3 Community License
- **Use Case**: Standard helpful assistant conversations

#### 3. nomic-embed-text:latest
- **Type**: Embedding model (not generative)
- **Parameters**: ~137M
- **Context**: 8,192 tokens
- **License**: Apache 2.0
- **Use Cases**: 
  - Semantic text search
  - Document clustering
  - RAG (Retrieval-Augmented Generation)
  - Text similarity tasks

#### 4. qwen3.5:9b-64k
- **Base**: Qwen2.5 architecture
- **Extended Context**: 65,536 tokens
- **Generation Parameters**:
  - Temperature: 1.0
  - Top K: 20
  - Top P: 0.95
  - Presence Penalty: 1.5
- **License**: Apache 2.0
- **Use Case**: Long document processing, extended context tasks

### Cloud Models (Remote API)

#### 5. qwen3.5:397b-cloud
- **Architecture**: Qwen3.5
- **Parameters**: 397 Billion
- **Context Length**: 262,144 tokens (256K)
- **Quantization**: BF16 (Brain Float 16)
- **Capabilities**:
  - ✅ Completion
  - ✅ Thinking/Reasoning
  - ✅ Tool use
  - ✅ Vision (multimodal)
- **Use Case**: Complex reasoning, document analysis, image understanding

#### 6. glm-5:cloud
- **Architecture**: GLM-5 (Zhipu AI)
- **Parameters**: ~72 Billion
- **Context Length**: 202,752 tokens
- **Quantization**: FP8 (8-bit floating point)
- **Embedding Length**: 2,048
- **Capabilities**:
  - ✅ Thinking/Reasoning
  - ✅ Completion
  - ✅ Tool use
- **Use Case**: Mathematical reasoning, coding, complex problem solving

#### 7. kimi-k2.5:cloud ⭐ ACTIVE
- **Architecture**: Kimi-K2 (Moonshot AI)
- **Parameters**: 1.042 Trillion (1T)
- **Context Length**: 262,144 tokens (256K)
- **Quantization**: INT4 (4-bit integer)
- **Embedding Length**: 2,048
- **Capabilities**:
  - ✅ Vision (multimodal)
  - ✅ Thinking/Reasoning
  - ✅ Completion
  - ✅ Tool use
- **Use Case**: Currently active provider; best for agent tasks, multimodal analysis, very long context

#### 8. minimax-m2.7:cloud
- **Architecture**: MiniMax-M2
- **Context Length**: 204,800 tokens (200K)
- **Embedding Length**: 3,072
- **Capabilities**:
  - ✅ Completion
  - ✅ Tool use
  - ✅ Thinking/Reasoning
- **Use Case**: General cloud-based inference

---

## 🗝️ Key Terms

| Term | Explanation |
|------|-------------|
| **Parameters** | Number of trainable weights in the model (higher = more capable but slower) |
| **Context** | Maximum token length the model can process in a single conversation |
| **Quantization** | Precision reduction for model weights (Q4_0 = 4-bit, BF16 = 16-bit brain float, INT4 = 4-bit integer) |
| **BF16** | Brain Float 16 - 16-bit floating point format for cloud inference |
| **FP8** | 8-bit floating point - reduced precision for efficiency |
| **INT4** | 4-bit integer quantization - highest compression, used for very large models |
| **Q4_0/Q4_K_M** | 4-bit quantization levels for local GGUF models |

---

## 📊 Recommendations by Task

| Task | Recommended Model | Reason |
|------|-------------------|--------|
| General Chat | dolphin-llama3:8b | Fast, helpful, local |
| Long Documents | qwen3.5:9b-64k | 64K local context |
| Code Generation | qwen3.5:397b-cloud or glm-5:cloud | Strong reasoning |
| RAG/Embeddings | nomic-embed-text | Dedicated embedding model |
| Vision Tasks | kimi-k2.5:cloud | Trillion params + vision |
| Uncensored Tasks | uncensored:latest | Minimal filtering |
| Agent Workflows | kimi-k2.5:cloud | Best capabilities, currently active |

---

*Report generated from `ollama list` and `ollama show` commands*
