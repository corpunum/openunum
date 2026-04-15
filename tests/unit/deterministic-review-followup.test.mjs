import { describe, expect, it } from 'vitest';
import {
  buildDeterministicActionConfirmationReply,
  buildDeterministicImprovementProposalReply,
  buildDeterministicReviewFollowUpReply,
  buildDeterministicStandaloneFastReply,
  buildDeterministicSessionHistoryReviewReply,
  buildSessionSupportReply
} from '../../src/core/agent-helpers.mjs';

describe('deterministic review follow-up', () => {
  it('summarizes a deterministic repo review when asked for the results', () => {
    const reply = buildDeterministicReviewFollowUpReply({
      message: 'And what are the results ?',
      recentMessages: [
        {
          role: 'assistant',
          content: [
            'I checked implementation files: `/home/corp-unum/openunum/src/core/agent.mjs`, `/home/corp-unum/openunum/src/core/agent-helpers.mjs`.',
            'I checked documentation surfaces: `/home/corp-unum/openunum/docs/AGENT_ONBOARDING.md`, `/home/corp-unum/openunum/docs/INDEX.md`, `/home/corp-unum/openunum/docs/archive/agent-onboarding.md`, `/home/corp-unum/openunum/docs/CHANGELOG_CURRENT.md`.',
            'One clear mismatch is retrieval drift: the route pulled the archived onboarding doc `/home/corp-unum/openunum/docs/archive/agent-onboarding.md` while the live onboarding doc is `/home/corp-unum/openunum/docs/AGENT_ONBOARDING.md`.',
            'That means canonical docs are still too easy to lose to archive/history files during answers.',
            'Provenance: synthesized from 2 tool surface(s): file_search, file_read.'
          ].join('\n')
        }
      ]
    });
    expect(reply).toContain('retrieval drift');
    expect(reply).toContain('canonical docs');
    expect(reply).not.toContain('I checked implementation files');
    expect(reply).not.toContain('Provenance:');
  });

  it('builds framework remediation steps for retrieval drift follow-ups', () => {
    const reply = buildDeterministicReviewFollowUpReply({
      message: 'So how to resolve that ? Can you tell me if you can do anything about it ?',
      recentMessages: [
        {
          role: 'assistant',
          content: [
            'I checked implementation files: `/home/corp-unum/openunum/src/core/agent.mjs`, `/home/corp-unum/openunum/src/core/agent-helpers.mjs`.',
            'One clear mismatch is retrieval drift: the route pulled the archived onboarding doc `/home/corp-unum/openunum/docs/archive/agent-onboarding.md` while the live onboarding doc is `/home/corp-unum/openunum/docs/AGENT_ONBOARDING.md`.',
            'That means canonical docs are still too easy to lose to archive/history files during answers.',
            'From current evidence, the code and docs both exist, but the answer path is not reliably preferring the canonical documentation set over archive material.'
          ].join('\n')
        }
      ]
    });
    expect(reply).toContain('framework fix');
    expect(reply).toContain('canonical docs');
    expect(reply).toContain('docs/archive/**');
    expect(reply).toContain('regression');
  });

  it('accepts address-that phrasing from Telegram follow-ups', () => {
    const reply = buildDeterministicReviewFollowUpReply({
      message: 'And what we will need you to do to address that ?',
      recentMessages: [
        {
          role: 'assistant',
          content: [
            'I checked implementation files: `/home/corp-unum/openunum/src/core/agent.mjs`, `/home/corp-unum/openunum/src/core/agent-helpers.mjs`.',
            'One clear mismatch is retrieval drift: the route pulled the archived onboarding doc `/home/corp-unum/openunum/docs/archive/agent-onboarding.md` while the live onboarding doc is `/home/corp-unum/openunum/docs/AGENT_ONBOARDING.md`.',
            'That means canonical docs are still too easy to lose to archive/history files during answers.',
            'From current evidence, the code and docs both exist, but the answer path is not reliably preferring the canonical documentation set over archive material.'
          ].join('\n')
        }
      ]
    });
    expect(reply).toContain('framework fix');
    expect(reply).toContain('canonical docs');
    expect(reply).toContain('regression');
  });

  it('builds framework remediation steps for fragmented runtime findings', () => {
    const reply = buildDeterministicReviewFollowUpReply({
      message: 'So what do we do with the harness then ?',
      recentMessages: [
        {
          role: 'assistant',
          content: [
            'From current code evidence, meta harness is not implemented as a first-class runtime module.',
            'The strongest runtime hit is `/home/corp-unum/openunum/src/core/autonomy-nudges.mjs`, where meta-harness review appears as an autonomy nudge rather than a standalone subsystem.',
            'Most of the other evidence is in docs, which means the concept is documented, but only partially operationalized in runtime code.'
          ].join('\n')
        }
      ]
    });
    expect(reply).toContain('canonical runtime surface');
    expect(reply).toContain('docs, tests, and deterministic inspection');
  });

  it('accepts broader user-style summary phrasings', () => {
    const reply = buildDeterministicReviewFollowUpReply({
      message: 'Ok summarize the harness issue directly please',
      recentMessages: [
        {
          role: 'assistant',
          content: [
            'From current code evidence, meta harness is not implemented as a first-class runtime module.',
            'Most of the other evidence is in docs, which means the concept is documented, but only partially operationalized in runtime code.'
          ].join('\n')
        }
      ]
    });
    expect(reply).toContain('not implemented as a first-class runtime module');
    expect(reply).toContain('partially operationalized');
  });

  it('does not trigger on unrelated conversational follow-ups', () => {
    const reply = buildDeterministicReviewFollowUpReply({
      message: 'Are you alive ?',
      recentMessages: [
        { role: 'assistant', content: 'Yes, I am here.' }
      ]
    });
    expect(reply).toBe('');
  });

  it('treats action confirmations after remediation plans as deterministic follow-ups', () => {
    const reply = buildDeterministicActionConfirmationReply({
      message: 'Ok do these all',
      recentMessages: [
        {
          role: 'assistant',
          content: [
            'The framework fix is to correct the source of the drift, then lock it with regression coverage.',
            '1. Make canonical docs first-class in retrieval and answer synthesis, and demote archive/history surfaces by default.',
            '2. Only let `docs/archive/**` participate when the user explicitly asks for history, archive, or comparison against old plans.',
            '3. Add a parity regression for the onboarding/changelog review prompt plus its follow-up resolution question.'
          ].join('\n')
        }
      ]
    });
    expect(reply).toContain('Understood. The work to do is');
    expect(reply).toContain('Make canonical docs first-class');
    expect(reply).toContain('Telegram/session imitation regressions');
  });

  it('treats short contextual acknowledgements as action confirmations after a remediation plan', () => {
    const reply = buildDeterministicActionConfirmationReply({
      message: 'ok',
      recentMessages: [
        {
          role: 'assistant',
          content: [
            'The framework fix is to correct the source of the drift, then lock it with regression coverage.',
            '1. Make canonical docs first-class in retrieval and answer synthesis, and demote archive/history surfaces by default.',
            '2. Only let `docs/archive/**` participate when the user explicitly asks for history, archive, or comparison against old plans.',
            '3. Add a parity regression for the onboarding/changelog review prompt plus its follow-up resolution question.'
          ].join('\n')
        }
      ]
    });
    expect(reply).toContain('Understood. The work to do is');
    expect(reply).toContain('Make canonical docs first-class');
  });

  it('treats short acknowledgements as action confirmations after review proposal replies', () => {
    const reply = buildDeterministicActionConfirmationReply({
      message: 'ok',
      recentMessages: [
        {
          role: 'assistant',
          content: [
            'Based on my review of the codebase, here are my concrete proposals:',
            '1. Fix canonical retrieval priority.',
            '2. Add deterministic parity regressions for Telegram/session follow-ups.',
            '3. Tighten completion guards to block recovery-style user output.'
          ].join('\n')
        }
      ]
    });
    expect(reply).toContain('Understood. The work to do is');
    expect(reply).toContain('Fix canonical retrieval priority');
  });

  it('does not misread quoted remediation text as a malformed response complaint', () => {
    const supportReply = buildSessionSupportReply({
      message: 'Do that "The framework fix is to correct the source of the drift, then lock it with regression coverage."',
      sessionId: 'telegram:7277166932',
      recentMessages: [
        {
          role: 'assistant',
          content: 'The framework fix is to correct the source of the drift, then lock it with regression coverage.\n1. Make canonical docs first-class in retrieval and answer synthesis, and demote archive/history surfaces by default.'
        }
      ]
    });
    const actionReply = buildDeterministicActionConfirmationReply({
      message: 'Do that "The framework fix is to correct the source of the drift, then lock it with regression coverage."',
      recentMessages: [
        {
          role: 'assistant',
          content: 'The framework fix is to correct the source of the drift, then lock it with regression coverage.\n1. Make canonical docs first-class in retrieval and answer synthesis, and demote archive/history surfaces by default.'
        }
      ]
    });
    expect(supportReply).toBe('');
    expect(actionReply).toContain('Understood. The work to do is');
  });

  it('reviews latest Telegram message quality directly instead of falling into tool summaries', () => {
    const reply = buildDeterministicSessionHistoryReviewReply({
      message: 'You responses are to generic , can you read latest telegram msgs and fix the issues as per my requests ?',
      sessionId: 'telegram:7277166932',
      recentMessages: [
        { role: 'assistant', content: 'Ready. Tell me what you want to do next.' },
        { role: 'assistant', content: 'Status: ok\nFindings:\nfile_search: ✅ completed' },
        { role: 'user', content: 'Ok do these all' }
      ]
    });
    expect(reply).toContain('latest Telegram turns');
    expect(reply).toContain('recovery formatting');
    expect(reply).toContain('action-confirmation turn');
  });

  it('accepts shorthand latest-msg follow-up wording from Telegram', () => {
    const reply = buildDeterministicSessionHistoryReviewReply({
      message: 'better but check latet msgs to fix',
      sessionId: 'telegram:7277166932',
      recentMessages: [
        { role: 'assistant', content: 'Ready. Tell me what you want to do next.' },
        { role: 'assistant', content: 'Status: ok\nFindings:\nfile_search: ✅ completed' },
        { role: 'user', content: 'Ok do these all' }
      ]
    });
    expect(reply).toContain('latest Telegram turns');
    expect(reply).toContain('recovery formatting');
  });

  it('returns direct OpenUnum improvement proposals for product-level review prompts', () => {
    const reply = buildDeterministicImprovementProposalReply({
      message: 'What we can improve in for openunum ? What do you think ?',
      recentMessages: []
    });
    expect(reply).toContain('Top improvement proposals for OpenUnum right now');
    expect(reply).toContain('Autonomous Self-Awareness Loop');
    expect(reply).toContain('Autonomous Self-Development Pipeline');
  });

  it('handles loose follow-up after improvement proposals without generic fallback', () => {
    const reply = buildDeterministicImprovementProposalReply({
      message: 'So ... ?',
      recentMessages: [
        {
          role: 'assistant',
          content: [
            'Top improvement proposals for OpenUnum right now:',
            '1. Autonomous Self-Awareness Loop',
            '2. Autonomous Self-Development Pipeline'
          ].join('\n')
        }
      ]
    });
    expect(reply).toContain('Priority order to execute now');
    expect(reply).toContain('Autonomous Self-Awareness Loop');
  });

  it('returns standalone remediation flow when no prior review context exists', () => {
    const reply = buildDeterministicStandaloneFastReply({
      message: 'So how to resolve that ? Can you tell me if you can do anything about it ?',
      recentMessages: []
    });
    expect(reply).toContain('no prior review context');
    expect(reply).toContain('Framework remediation flow');
  });

  it('returns direct diagnosis for tool failure prompts', () => {
    const reply = buildDeterministicStandaloneFastReply({
      message: 'Tool web_fetch failed 5 times. Last error: tool_circuit_open. Diagnose root cause and propose a fix or workaround.'
    });
    expect(reply).toContain('circuit breaker opened');
    expect(reply).toContain('Stop retrying the same tool path');
  });

  it('returns concise table clarification for no-link requests', () => {
    const reply = buildDeterministicStandaloneFastReply({
      message: 'make the table now no links and concise'
    });
    expect(reply).toContain('concise table with no links');
    expect(reply).toContain('exact topic + columns');
  });

  it('handles no-link table phrasing with dont-give-links wording', () => {
    const reply = buildDeterministicStandaloneFastReply({
      message: 'i need you to construct the table for me , dont give me links'
    });
    expect(reply).toContain('concise table with no links');
  });

  it('handles standalone generic-response complaints directly', () => {
    const reply = buildDeterministicStandaloneFastReply({
      message: 'You responses are to generic , can you read latest telegram msgs and fix the issues as per my requests ?'
    });
    expect(reply).toContain('keep responses direct');
    expect(reply).toContain('deterministic support lanes');
  });

  it('parses broad tool failure diagnostic prompts with full error text', () => {
    const reply = buildDeterministicStandaloneFastReply({
      message: "Tool file_read failed 3 times. Last error: ENOENT: no such file or directory, open '/home/corp-unum/openunum/src/providers/mistral.mjs'. Diagnose root cause and propose a fix or workaround."
    });
    expect(reply).toContain('file_read');
    expect(reply).toContain('ENOENT');
    expect(reply).toContain('Stop retrying the same tool path');
  });

  it('handles standalone continuation-only prompts quickly', () => {
    const reply = buildDeterministicStandaloneFastReply({
      message: 'continue'
    });
    expect(reply).toContain('can continue immediately');
    expect(reply).toContain('exact target task');
  });

  it('handles standalone capability-awareness prompts directly', () => {
    const reply = buildDeterministicStandaloneFastReply({
      message: 'are you aware on the system you operating the permissions you have and the abilities ?'
    });
    expect(reply).toContain('tool-gated permissions');
    expect(reply).toContain('runtime constraints');
  });

  it('handles standalone remember-fact prompts directly', () => {
    const reply = buildDeterministicStandaloneFastReply({
      message: 'Remember this test fact: self-test-runner-active'
    });
    expect(reply).toContain('remembered fact');
  });

  it('handles constrained github month-search prompts without long execution path', () => {
    const reply = buildDeterministicStandaloneFastReply({
      message: 'can you search the best github open source project of month march and april 2026 ? so new entries only within march and april'
    });
    expect(reply).toContain('constrained search task');
    expect(reply).toContain('March-April 2026');
  });

  it('handles ranked site-search prompts without long execution path', () => {
    const reply = buildDeterministicStandaloneFastReply({
      message: 'search the best news sites in Greece'
    });
    expect(reply).toContain('ranked search task');
    expect(reply).toContain('top set');
  });

  it('handles repeated best-search github prompt variants', () => {
    const reply = buildDeterministicStandaloneFastReply({
      message: 'repeat: best github open source project march april 2026 new entries only'
    });
    expect(reply).toContain('constrained search task');
    expect(reply).toContain('March-April 2026');
  });

  it('handles emotional support opener without long execution path', () => {
    const reply = buildDeterministicStandaloneFastReply({
      message: 'i want to tell you how i feel today for you to help me'
    });
    expect(reply).toContain('I can help with that');
    expect(reply).toContain('one or two lines');
  });

  it('handles short app-definition prompt directly', () => {
    const reply = buildDeterministicStandaloneFastReply({
      message: 'what is app ?'
    });
    expect(reply).toContain('software built to perform specific tasks');
  });
});
