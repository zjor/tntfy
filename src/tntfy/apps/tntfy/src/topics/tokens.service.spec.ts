import { describe, it, expect } from 'vitest';
import { TokensService, TOKEN_REGEX } from './tokens.service';

describe('TokensService.generate', () => {
  it('produces tokens matching tk_<24 url-safe chars>', () => {
    const svc = new TokensService(undefined as any, undefined as any);
    for (let i = 0; i < 50; i++) {
      const t = svc.generate();
      expect(t).toMatch(TOKEN_REGEX);
    }
  });

  it('does not collide across many calls', () => {
    const svc = new TokensService(undefined as any, undefined as any);
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(svc.generate());
    expect(set.size).toBe(1000);
  });
});
