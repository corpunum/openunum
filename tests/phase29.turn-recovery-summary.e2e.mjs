import assert from 'node:assert/strict';
import { normalizeRecoveredFinalText, synthesizeToolOnlyAnswer } from '../src/core/turn-recovery-summary.mjs';

const executedTools = [
  {
    name: 'http_request',
    result: {
      ok: true,
      json: [
        {
          modelId: 'HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive',
          downloads: 700000,
          likes: 933,
          tags: ['gguf', 'uncensored', 'qwen3.5', 'conversational']
        },
        {
          modelId: 'mradermacher/Llama3.3-8B-Heretic-Uncensored-GGUF',
          downloads: 180000,
          likes: 650,
          tags: ['gguf', 'uncensored', 'llama', 'conversational']
        },
        {
          modelId: 'HauhauCS/Qwen3.5-35B-A3B-Uncensored-HauhauCS-Aggressive',
          downloads: 652000,
          likes: 1153,
          tags: ['gguf', 'uncensored', 'qwen3.5', 'moe']
        },
        {
          modelId: 'HauhauCS/Qwen3.5-4B-Uncensored-HauhauCS-Aggressive',
          downloads: 182000,
          likes: 254,
          tags: ['gguf', 'uncensored', 'qwen3.5']
        },
        {
          modelId: 'aoxo/sarvam-105b-uncensored',
          downloads: 121000,
          likes: 2,
          tags: ['transformers', 'safetensors', 'uncensored']
        },
        {
          modelId: 'DavidAU/OpenAi-GPT-oss-20b-abliterated-uncensored-NEO-Imatrix-gguf',
          downloads: 90000,
          likes: 474,
          tags: ['gguf', 'uncensored', 'text-generation']
        }
      ]
    }
  },
  {
    name: 'shell_run',
    result: {
      ok: true,
      stdout: [
        'CPU(s):                                  16',
        'Model name:                              AMD Ryzen Z1 Extreme',
        'Mem:            17Gi       5.3Gi       9.1Gi       111Mi       3.4Gi        11Gi',
        'No NVIDIA GPU detected'
      ].join('\n')
    }
  }
];

const userMessage = 'search the best model we can run for this hardware .. give me a top5 , we need free local models unsensored, dont install anything';

const recovered = synthesizeToolOnlyAnswer({
  userMessage,
  executedTools,
  toolRuns: executedTools.length
});

assert.match(recovered, /Hardware: AMD Ryzen Z1 Extreme/);
assert.match(recovered, /RAM≈17\.0 GiB/);
assert.match(recovered, /1\. HauhauCS\/Qwen3\.5-9B-Uncensored-HauhauCS-Aggressive/);
assert.match(recovered, /No install action was taken\./);
assert.match(recovered, /Provenance: synthesized from/);
assert.ok(recovered.length < 2500, 'recovered answer should stay compact');
assert.ok(!recovered.includes('aoxo/sarvam-105b-uncensored'), 'poor-fit 105B model should be filtered out');

const rawFallback = `Tool actions executed (3) but model returned no final message.\nExecuted actions:\n1. http_request({}) => ${'x'.repeat(50000)}`;
const normalized = normalizeRecoveredFinalText({
  finalText: rawFallback,
  userMessage,
  executedTools,
  toolRuns: 3
});

assert.equal(normalized, recovered);
assert.ok(normalized.length < 2500, 'normalized fallback should stay compact');

const statusRecovery = synthesizeToolOnlyAnswer({
  userMessage: 'inspect the runtime and report status',
  executedTools: [
    { name: 'http_request', result: { ok: true, status: 200, url: 'http://127.0.0.1:18880/api/health' } },
    { name: 'shell_run', result: { ok: false, error: 'command_failed' } }
  ],
  toolRuns: 2
});
assert.match(statusRecovery, /^Status: partial/m);
assert.match(statusRecovery, /Findings:/);
assert.match(statusRecovery, /Provenance: synthesized from 2 tool surface/);

console.log('phase29.turn-recovery-summary.e2e: ok');
