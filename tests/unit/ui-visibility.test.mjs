import { describe, it, expect } from 'vitest';
import {
  knownProviderRowIds,
  knownServiceRowIds,
  normalizeHiddenRows,
  buildAddRowSelectMarkup
} from '../../src/ui/modules/visibility.js';

describe('ui visibility helpers', () => {
  it('builds known provider/service ids from config and catalog rows', () => {
    expect(knownProviderRowIds(['ollama-cloud'], [{ provider: 'nvidia' }])).toEqual(['ollama-cloud', 'nvidia']);
    expect(knownServiceRowIds(['github'], [{ id: 'telegram' }])).toEqual(['github', 'telegram']);
  });

  it('normalizes hidden rows against known ids', () => {
    const out = normalizeHiddenRows({
      hiddenProviderRows: ['ollama-cloud', 'unknown', 'ollama-cloud'],
      hiddenServiceRows: ['github', 'x', 'github'],
      knownProviders: ['ollama-cloud', 'nvidia'],
      knownServices: ['github', 'telegram']
    });
    expect(out.hiddenProviderRows).toEqual(['ollama-cloud']);
    expect(out.hiddenServiceRows).toEqual(['github']);
  });

  it('builds add-row selector options from hidden rows', () => {
    const out = buildAddRowSelectMarkup({
      knownProviders: ['ollama-cloud', 'nvidia'],
      knownServices: ['github', 'telegram'],
      hiddenProviderRows: ['nvidia'],
      hiddenServiceRows: ['telegram']
    });
    expect(out.providerOptions.includes('value="nvidia"')).toBe(true);
    expect(out.providerOptions.includes('value="ollama-cloud"')).toBe(false);
    expect(out.serviceOptions.includes('value="telegram"')).toBe(true);
    expect(out.serviceOptions.includes('value="github"')).toBe(false);
  });
});
