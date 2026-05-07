import { describe, it, expect } from 'vitest';
import { renderTopicCreatedMessage, htmlEscape } from './snippets';

describe('snippets', () => {
  it('renders topic + spoiler-wrapped token + curl + python', () => {
    const out = renderTopicCreatedMessage({
      name: 'deploys',
      token: 'tk_aaaaaaaaaaaaaaaaaaaaaaaa',
      baseUrl: 'https://tntfy.example.com',
    });
    expect(out).toContain('<b>Topic:</b> deploys');
    expect(out).toContain('<tg-spoiler>tk_aaaaaaaaaaaaaaaaaaaaaaaa</tg-spoiler>');
    expect(out).toContain('curl -H "Authorization: Bearer tk_aaaaaaaaaaaaaaaaaaaaaaaa"');
    expect(out).toContain('https://tntfy.example.com/v1/publish/deploys');
    expect(out).toContain('import requests');
  });

  it('html-escapes inputs to prevent injection', () => {
    expect(htmlEscape('<script>')).toBe('&lt;script&gt;');
    expect(htmlEscape('a & b')).toBe('a &amp; b');
  });
});
