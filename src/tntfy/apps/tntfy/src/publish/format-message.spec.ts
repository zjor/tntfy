import { describe, it, expect } from 'vitest';
import { escapeMarkdownV2, formatText, formatCaption } from './format-message';

describe('escapeMarkdownV2', () => {
  it('escapes every reserved char', () => {
    const all = '_*[]()~`>#+-=|{}.!\\';
    const escaped = escapeMarkdownV2(all);
    // Each input char should now be preceded by exactly one backslash.
    for (const ch of all) {
      expect(escaped).toContain('\\' + ch);
    }
  });

  it('escapes hyphens and underscores in topic names', () => {
    expect(escapeMarkdownV2('app-1_alpha')).toBe('app\\-1\\_alpha');
  });

  it('leaves alphanumerics alone', () => {
    expect(escapeMarkdownV2('deploys')).toBe('deploys');
  });
});

describe('formatText', () => {
  it('plain — wraps topic in brackets to separate it from the body', () => {
    expect(formatText('deploys', 'Backup successful', 'none')).toBe(
      '[deploys]\n\nBackup successful',
    );
  });

  it('MarkdownV2 — bolds the topic with the proper escape', () => {
    expect(formatText('app-1', 'hi *bold*', 'MarkdownV2')).toBe(
      '*app\\-1*\n\nhi *bold*',
    );
  });

  it('HTML — bolds the topic with <b>; topic regex disallows HTML specials so no escape needed', () => {
    expect(formatText('deploys', '<b>x</b>', 'HTML')).toBe(
      '<b>deploys</b>\n\n<b>x</b>',
    );
  });
});

describe('formatCaption', () => {
  it('returns the bracketed topic when no user caption', () => {
    expect(formatCaption('deploys')).toBe('[deploys]');
    expect(formatCaption('deploys', '')).toBe('[deploys]');
  });

  it('prepends bracketed topic on its own line when caption is set', () => {
    expect(formatCaption('deploys', 'see attached')).toBe('[deploys]\nsee attached');
  });
});
