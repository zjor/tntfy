import { describe, it, expect } from 'vitest';
import { resolveFilename, mimeToExt } from './filename';

describe('mimeToExt', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/gif', 'gif'],
    ['image/webp', 'webp'],
    ['image/anything', 'bin'],
    ['application/octet-stream', 'bin'],
    ['audio/mpeg', 'bin'],
    ['video/mp4', 'bin'],
    ['', 'bin'],
  ])('%s → %s', (mime, ext) => {
    expect(mimeToExt(mime)).toBe(ext);
  });
});

describe('resolveFilename', () => {
  it('returns the provided filename trimmed when set', () => {
    expect(resolveFilename({ filename: '  picture.png  ', mimeType: 'image/png' })).toBe('picture.png');
  });

  it('generates attachment-<8>.<ext> when filename missing', () => {
    const out = resolveFilename({ filename: undefined, mimeType: 'image/jpeg' });
    expect(out).toMatch(/^attachment-[A-Za-z0-9_-]{8}\.jpg$/);
  });

  it('generates with bin extension for unknown mime', () => {
    const out = resolveFilename({ filename: undefined, mimeType: 'application/x-weird' });
    expect(out).toMatch(/^attachment-[A-Za-z0-9_-]{8}\.bin$/);
  });
});
