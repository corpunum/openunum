import assert from 'node:assert/strict';
import { startServer, stopServer, jget, jpost } from './_helpers.mjs';

const REVIEW_PROMPT = 'Check your code and latest changelogs , also agentonboarding and tell me if all make sense for you , you think we miss something , or something is not linked to code or used ?';
const HARNESS_PROMPT = 'How is meta harness is working for openunum ?';
const RECOVERY_STUB = 'Status: ok\nFindings:\nfile_read: ✅ read /home/corp-unum/openunum/docs/CHANGELOG_CURRENT.md\nfile_read: ✅ read /home/corp-unum/openunum/docs/CHANGELOG_POLICY.md';

async function importSession(sessionId, messages) {
  const out = await jpost('/api/sessions/import', { sessionId, messages });
  assert.equal(out.status, 200, `import failed for ${sessionId}`);
  assert.equal(out.json?.ok, true, `import not ok for ${sessionId}`);
}

async function sendAndAwait(sessionId, message, timeoutMs = 30000) {
  const first = await jpost('/api/chat', { sessionId, message });
  if (first.status === 200) return first.json;
  assert.equal(first.status, 202, `unexpected status for ${sessionId}: ${first.status}`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const pending = await jget(`/api/chat/pending?sessionId=${encodeURIComponent(sessionId)}`);
    assert.equal(pending.status, 200, `pending status failed for ${sessionId}`);
    if (pending.json?.completed) return pending.json;
    if (pending.json?.pending === false) {
      const session = await jget(`/api/sessions/${encodeURIComponent(sessionId)}`);
      assert.equal(session.status, 200, `session fetch failed for ${sessionId}`);
      const messages = Array.isArray(session.json?.messages) ? session.json.messages : [];
      const lastAssistant = [...messages].reverse().find((item) => item?.role === 'assistant');
      if (lastAssistant?.content) {
        return { reply: lastAssistant.content, trace: { note: 'session_fetch_fallback' } };
      }
    }
  }
  throw new Error(`timed out waiting for chat completion: ${sessionId}`);
}

function assertCommonCleanReply(name, reply, { allowStatusHeader = false } = {}) {
  assert.equal(typeof reply, 'string', `${name}: reply must be string`);
  assert.ok(reply.trim().length > 0, `${name}: reply must not be empty`);
  if (!allowStatusHeader) {
    assert.equal(/^Status:\s+/m.test(reply), false, `${name}: leaked status header`);
    assert.equal(/\nFindings:\n/m.test(reply), false, `${name}: leaked findings block`);
  }
}

const cases = [
  {
    name: 'real-start-command',
    sessionId: 'telegram:phase51-start',
    message: '/start',
    expect(out) {
      assert.equal(out.trace?.note, 'slash_command:start');
      assert.match(out.reply, /\/new/);
    }
  },
  {
    name: 'real-support-follow-up',
    sessionId: 'telegram:phase51-support-follow',
    async setup(sessionId) {
      await sendAndAwait(sessionId, '/start');
    },
    message: 'So ... ?',
    expect(out) {
      assert.equal(out.trace?.note, 'session_support_reply');
      assert.match(out.reply, /already talking to OpenUnum through Telegram/i);
    }
  },
  {
    name: 'real-status-command',
    sessionId: 'telegram:phase51-status',
    message: '/status',
    expect(out) {
      assert.equal(out.trace?.note, 'slash_command:status');
      assert.match(out.reply, /provider\/model:/i);
    }
  },
  {
    name: 'real-new-command',
    sessionId: 'telegram:phase51-new',
    message: '/new',
    expect(out) {
      assert.equal(out.trace?.note, 'slash_command:new');
      assert.match(out.reply, /Starting fresh/i);
    }
  },
  {
    name: 'real-alive-question',
    sessionId: 'telegram:phase51-alive',
    message: 'Are you alive ?',
    expect(out) {
      assert.equal(out.trace?.note, 'conversational_alive_handled');
      assert.match(out.reply, /operational/i);
    }
  },
  {
    name: 'real-review-prompt',
    sessionId: 'telegram:phase51-review',
    message: REVIEW_PROMPT,
    expect(out) {
      assert.equal(out.trace?.note, 'deterministic_repo_inspection');
      assert.match(out.reply, /retrieval drift/i);
    }
  },
  {
    name: 'real-review-results-follow-up',
    sessionId: 'telegram:phase51-review-results',
    async setup(sessionId) {
      await sendAndAwait(sessionId, REVIEW_PROMPT);
    },
    message: 'And what are the results ?',
    expect(out) {
      assert.equal(out.trace?.note, 'deterministic_review_follow_up');
      assert.match(out.reply, /retrieval drift/i);
    }
  },
  {
    name: 'real-review-remediation-follow-up-1',
    sessionId: 'telegram:phase51-review-resolve-1',
    async setup(sessionId) {
      await sendAndAwait(sessionId, REVIEW_PROMPT);
    },
    message: 'So how we can resolve that ?',
    expect(out) {
      assert.equal(out.trace?.note, 'deterministic_review_follow_up');
      assert.match(out.reply, /framework fix/i);
      assert.match(out.reply, /docs\/archive\/\*\*/i);
    }
  },
  {
    name: 'real-review-remediation-follow-up-2',
    sessionId: 'telegram:phase51-review-resolve-2',
    async setup(sessionId) {
      await sendAndAwait(sessionId, REVIEW_PROMPT);
    },
    message: 'So how to resolve that ? Can you tell me if you can do anything about it ?',
    expect(out) {
      assert.equal(out.trace?.note, 'deterministic_review_follow_up');
      assert.match(out.reply, /framework fix/i);
      assert.match(out.reply, /regression/i);
    }
  },
  {
    name: 'real-review-address-that-follow-up',
    sessionId: 'telegram:phase51-review-address-that',
    async setup(sessionId) {
      await sendAndAwait(sessionId, REVIEW_PROMPT);
    },
    message: 'And what we will need you to do to address that ?',
    expect(out) {
      assert.equal(out.trace?.note, 'deterministic_review_follow_up');
      assert.match(out.reply, /framework fix/i);
      assert.match(out.reply, /canonical docs/i);
    }
  },
  {
    name: 'real-harness-review',
    sessionId: 'telegram:phase51-harness',
    message: HARNESS_PROMPT,
    expect(out) {
      assert.equal(out.trace?.note, 'deterministic_repo_inspection');
      assert.match(out.reply, /first-class runtime module/i);
    }
  },
  {
    name: 'real-telegram-clear-request',
    sessionId: 'telegram:phase51-clear-request',
    message: 'Proceed i need somehow to start a new clear session chat through telegram',
    expect(out) {
      assert.equal(out.trace?.note, 'session_support_reply');
      assert.match(out.reply, /\/new/);
    }
  },
  {
    name: 'real-telegram-session-command-question',
    sessionId: 'telegram:phase51-session-help',
    message: 'So if I wanted to start a new telegram session with openunum is there an order ./..? If not can we create one like /status is working?',
    expect(out) {
      assert.equal(out.trace?.note, 'session_support_reply');
      assert.match(out.reply, /\/status/);
      assert.match(out.reply, /\/new/);
    }
  },
  {
    name: 'real-telegram-bot-assertion',
    sessionId: 'telegram:phase51-bot-assertion',
    message: 'But I chat with you through telegram so really maybe you are wrong ? This message specifically is been delivered to you through a telegram bot',
    expect(out) {
      assert.equal(out.trace?.note, 'session_support_reply');
      assert.match(out.reply, /already talking to OpenUnum through Telegram/i);
    }
  },
  {
    name: 'real-action-confirmation-short',
    sessionId: 'telegram:phase51-action-confirmation-short',
    async setup(sessionId) {
      await importSession(sessionId, [
        {
          role: 'assistant',
          content: [
            'The framework fix is to correct the source of the drift, then lock it with regression coverage.',
            '1. Make canonical docs first-class in retrieval and answer synthesis, and demote archive/history surfaces by default.',
            '2. Only let `docs/archive/**` participate when the user explicitly asks for history, archive, or comparison against old plans.',
            '3. Add a parity regression for the onboarding/changelog review prompt plus its follow-up resolution question.'
          ].join('\n')
        }
      ]);
    },
    message: 'Ok do these all',
    expect(out) {
      assert.equal(out.trace?.note, 'deterministic_action_confirmation');
      assert.match(out.reply, /Understood\. The work to do is:/i);
      assert.match(out.reply, /Make canonical docs first-class/i);
    }
  },
  {
    name: 'real-action-confirmation-quoted',
    sessionId: 'telegram:phase51-action-confirmation-quoted',
    async setup(sessionId) {
      await importSession(sessionId, [
        {
          role: 'assistant',
          content: [
            'The framework fix is to correct the source of the drift, then lock it with regression coverage.',
            '1. Make canonical docs first-class in retrieval and answer synthesis, and demote archive/history surfaces by default.',
            '2. Only let `docs/archive/**` participate when the user explicitly asks for history, archive, or comparison against old plans.',
            '3. Add a parity regression for the onboarding/changelog review prompt plus its follow-up resolution question.'
          ].join('\n')
        }
      ]);
    },
    message: 'Do that "The framework fix is to correct the source of the drift, then lock it with regression coverage."',
    expect(out) {
      assert.equal(out.trace?.note, 'deterministic_action_confirmation');
      assert.match(out.reply, /Understood\. The work to do is:/i);
      assert.equal(/recovery summary from tool inspection/i.test(out.reply), false);
    }
  },
  {
    name: 'real-session-quality-review',
    sessionId: 'telegram:phase51-session-quality-review',
    async setup(sessionId) {
      await importSession(sessionId, [
        { role: 'assistant', content: 'Ready. Tell me what you want to do next.' },
        { role: 'assistant', content: 'Status: ok\nFindings:\nfile_search: ✅ completed' },
        { role: 'user', content: 'Ok do these all' }
      ]);
    },
    message: 'You responses are to generic , can you read latest telegram msgs and fix the issues as per my requests ?',
    expect(out) {
      assert.equal(out.trace?.note, 'deterministic_session_history_review');
      assert.match(out.reply, /latest Telegram turns/i);
      assert.match(out.reply, /recovery formatting/i);
      assert.match(out.reply, /action-confirmation turn/i);
    }
  },
  {
    name: 'real-openunum-improvement-review',
    sessionId: 'telegram:phase51-openunum-improve',
    message: 'What we can improve in for openunum ? What do you think ?',
    expect(out) {
      assert.equal(out.trace?.note, 'deterministic_product_improvement');
      assert.match(out.reply, /Top improvement proposals for OpenUnum right now/i);
      assert.match(out.reply, /Self-Awareness Loop/i);
    }
  },
  {
    name: 'real-openunum-improvement-follow-up',
    sessionId: 'telegram:phase51-openunum-improve-follow',
    async setup(sessionId) {
      await sendAndAwait(sessionId, 'What we can improve in for openunum ? What do you think ?');
    },
    message: 'So ... ?',
    expect(out) {
      assert.equal(out.trace?.note, 'deterministic_product_improvement');
      assert.match(out.reply, /Priority order to execute now/i);
      assert.match(out.reply, /Self-Development Pipeline/i);
    }
  },
  {
    name: 'real-malformed-why',
    sessionId: 'telegram:phase51-malformed-why',
    async setup(sessionId) {
      await importSession(sessionId, [
        { role: 'assistant', content: RECOVERY_STUB }
      ]);
    },
    message: 'Why not responding normally?',
    expect(out) {
      assert.equal(out.trace?.note, 'session_support_reply');
      assert.match(out.reply, /(recovery summary|wrong response path)/i);
    }
  },
  {
    name: 'real-malformed-again',
    sessionId: 'telegram:phase51-malformed-again',
    async setup(sessionId) {
      await importSession(sessionId, [
        { role: 'assistant', content: RECOVERY_STUB }
      ]);
    },
    message: 'Again',
    expect(out) {
      assert.equal(out.trace?.note, 'session_support_reply');
      assert.match(out.reply, /recovery summary/i);
    }
  },
  {
    name: 'real-malformed-drift-complaint',
    sessionId: 'telegram:phase51-malformed-drift',
    async setup(sessionId) {
      await importSession(sessionId, [
        { role: 'assistant', content: RECOVERY_STUB }
      ]);
    },
    message: 'I dont understand the way tou respond ..  is it for me or a drift ?',
    expect(out) {
      assert.equal(out.trace?.note, 'session_support_reply');
      assert.match(out.reply, /(recovery summary|wrong response path)/i);
    }
  },
  {
    name: 'imitated-review-framework-fix',
    sessionId: 'telegram:phase51-imitated-review-fix',
    async setup(sessionId) {
      await sendAndAwait(sessionId, REVIEW_PROMPT);
    },
    message: 'Ok how do we fix that in framework terms ?',
    expect(out) {
      assert.equal(out.trace?.note, 'deterministic_review_follow_up');
      assert.match(out.reply, /framework fix/i);
    }
  },
  {
    name: 'imitated-review-summary',
    sessionId: 'telegram:phase51-imitated-review-summary',
    async setup(sessionId) {
      await sendAndAwait(sessionId, REVIEW_PROMPT);
    },
    message: 'So what are the actual results then ?',
    expect(out) {
      assert.equal(out.trace?.note, 'deterministic_review_follow_up');
      assert.match(out.reply, /retrieval drift/i);
    }
  },
  {
    name: 'imitated-harness-remediation',
    sessionId: 'telegram:phase51-imitated-harness-fix',
    async setup(sessionId) {
      await sendAndAwait(sessionId, HARNESS_PROMPT);
    },
    message: 'So what do we do with the harness then ?',
    expect(out) {
      assert.equal(out.trace?.note, 'deterministic_review_follow_up');
      assert.match(out.reply, /canonical runtime surface/i);
    }
  },
  {
    name: 'imitated-harness-summary',
    sessionId: 'telegram:phase51-imitated-harness-summary',
    async setup(sessionId) {
      await sendAndAwait(sessionId, HARNESS_PROMPT);
    },
    message: 'Ok summarize the harness issue directly please',
    expect(out) {
      assert.equal(out.trace?.note, 'deterministic_review_follow_up');
      assert.match(out.reply, /first-class runtime module/i);
    }
  }
];

let proc;

try {
  proc = await startServer();

  for (const testCase of cases) {
    if (typeof testCase.setup === 'function') {
      await testCase.setup(testCase.sessionId);
    }
    const out = await sendAndAwait(testCase.sessionId, testCase.message);
    assertCommonCleanReply(testCase.name, out.reply, {
      allowStatusHeader: testCase.message === '/status'
    });
    testCase.expect(out);
  }

  console.log(`phase51.telegram-imitation-regression.e2e: ok (${cases.length} cases)`);
} finally {
  await stopServer(proc);
}
