import { describe, it, expect } from 'vitest';
import {
  buildChannelCommandOverview,
  buildSessionSupportReply,
  isChannelSupportQuestion,
  isMalformedResponseQuestion,
  isSessionResetQuestion,
  looksLikeToolRecoveryStub
} from '../../src/core/agent-helpers.mjs';

describe('session support helpers', () => {
  it('detects session reset requests without relying on one exact phrasing', () => {
    expect(isSessionResetQuestion('I need to start a new clear session chat through telegram')).toBe(true);
    expect(isSessionResetQuestion('I want a new telegram session')).toBe(true);
    expect(isSessionResetQuestion('please reset this conversation')).toBe(true);
    expect(isSessionResetQuestion('show the latest provider status')).toBe(false);
  });

  it('detects channel-support questions and vague follow-ups using recent context', () => {
    expect(isChannelSupportQuestion({
      message: 'So if I wanted to start a new telegram session with openunum is there an order ./..? If not can we create one like /status is working?',
      sessionId: 'telegram:7277166932',
      recentMessages: []
    })).toBe(true);
    expect(isChannelSupportQuestion({
      message: 'So ... ?',
      sessionId: 'telegram:7277166932',
      recentMessages: [
        { role: 'assistant', content: 'Use /new or /status in Telegram.' },
        { role: 'user', content: 'I need a telegram session command' }
      ]
    })).toBe(true);
    expect(isChannelSupportQuestion({
      message: 'So how to resolve that ? Can you tell me if you can do anything about it ?',
      sessionId: 'telegram:7277166932',
      recentMessages: [
        { role: 'assistant', content: 'You are already talking to OpenUnum through Telegram.\nUse /new to clear the current Telegram chat context and start fresh.' },
        { role: 'user', content: 'Check your code and latest changelogs , also agentonboarding and tell me if all make sense for you , you think we miss something , or something is not linked to code or used ?' },
        { role: 'assistant', content: 'I checked implementation files: `/home/corp-unum/openunum/src/core/agent.mjs`, `/home/corp-unum/openunum/src/core/agent-helpers.mjs`.\nOne clear mismatch is retrieval drift.' }
      ]
    })).toBe(false);
  });

  it('detects malformed response complaints and recovery stubs', () => {
    expect(isMalformedResponseQuestion('Why not responding normally?')).toBe(true);
    expect(isMalformedResponseQuestion('I dont understand the way you respond .. is it for me or a drift ?')).toBe(true);
    expect(looksLikeToolRecoveryStub('Status: ok\nFindings:\nhttp_request: ✅ HTTP 200')).toBe(true);
    expect(looksLikeToolRecoveryStub('Best next steps from current evidence:\n1. Use the verified result from `file_read` as the next execution anchor.')).toBe(true);
    expect(looksLikeToolRecoveryStub('Normal answer with no status header')).toBe(false);
  });

  it('builds a direct Telegram support reply for fresh-session requests', () => {
    const reply = buildSessionSupportReply({
      message: 'Proceed i need somehow to start a new clear session chat through telegram',
      sessionId: 'telegram:7277166932',
      recentMessages: []
    });
    expect(reply).toContain('/new');
    expect(reply).toContain('/session list');
    expect(reply).toContain('Telegram');
  });

  it('builds a channel-aware command overview for Telegram', () => {
    const reply = buildChannelCommandOverview('telegram:7277166932');
    expect(reply).toContain('already talking to OpenUnum through Telegram');
    expect(reply).toContain('/start');
    expect(reply).toContain('/new');
    expect(reply).toContain('/status');
  });

  it('answers Telegram command/session questions directly', () => {
    const reply = buildSessionSupportReply({
      message: 'So if I wanted to start a new telegram session with openunum is there an order ./..? If not can we create one like /status is working?',
      sessionId: 'telegram:7277166932',
      recentMessages: []
    });
    expect(reply).toContain('already talking to OpenUnum through Telegram');
    expect(reply).toContain('/new');
    expect(reply).toContain('/start');
  });

  it('does not hijack normal follow-up discussion inside Telegram sessions', () => {
    const reply = buildSessionSupportReply({
      message: 'So how to resolve that ? Can you tell me if you can do anything about it ?',
      sessionId: 'telegram:7277166932',
      recentMessages: [
        {
          role: 'assistant',
          content: 'You are already talking to OpenUnum through Telegram.\nThere is no separate `/telegram` command namespace.\nUse `/new` to clear the current Telegram chat context and start fresh.'
        },
        {
          role: 'user',
          content: 'Check your code and latest changelogs , also agentonboarding and tell me if all make sense for you , you think we miss something , or something is not linked to code or used ?'
        },
        {
          role: 'assistant',
          content: 'I checked implementation files: `/home/corp-unum/openunum/src/core/agent.mjs`, `/home/corp-unum/openunum/src/core/agent-helpers.mjs`.\nOne clear mismatch is retrieval drift.'
        }
      ]
    });
    expect(reply).toBe('');
  });

  it('explains malformed recovery formatting directly instead of falling into tools', () => {
    const reply = buildSessionSupportReply({
      message: 'Why not responding normally?',
      sessionId: 'telegram:7277166932',
      recentMessages: [
        {
          role: 'assistant',
          content: 'Status: ok\nFindings:\nfile_search: ✅ completed\nProvenance: synthesized'
        }
      ]
    });
    expect(reply).toContain('recovery summary');
    expect(reply).toContain('/new');
  });

  it('treats brief follow-up complaints like "Again" as malformed-response repair when the last answer was a recovery stub', () => {
    const reply = buildSessionSupportReply({
      message: 'Again',
      sessionId: 'telegram:7277166932',
      recentMessages: [
        {
          role: 'assistant',
          content: 'Best next steps from current evidence:\n1. Use the verified result from `file_read` as the next execution anchor.'
        }
      ]
    });
    expect(reply).toContain('recovery summary');
  });
});
