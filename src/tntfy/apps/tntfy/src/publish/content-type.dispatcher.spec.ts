import { describe, it, expect } from 'vitest';
import { dispatch } from './content-type.dispatcher';

describe('dispatch', () => {
  it('classifies text/plain as text + sendMessage + parse_mode none', () => {
    const r = dispatch('text/plain', 'hello');
    expect(r).toEqual({ kind: 'text', method: 'sendMessage', parseMode: 'none', text: 'hello' });
  });

  it('classifies text/markdown as text + MarkdownV2', () => {
    const r = dispatch('text/markdown', 'hi *bold*');
    expect(r).toMatchObject({ kind: 'text', method: 'sendMessage', parseMode: 'MarkdownV2' });
  });

  it('classifies text/html as text + HTML', () => {
    const r = dispatch('text/html', '<b>x</b>');
    expect(r).toMatchObject({ kind: 'text', method: 'sendMessage', parseMode: 'HTML' });
  });

  it('classifies application/x-www-form-urlencoded as plaintext (curl -d default)', () => {
    const r = dispatch('application/x-www-form-urlencoded', 'Hello from tntfy');
    expect(r).toEqual({ kind: 'text', method: 'sendMessage', parseMode: 'none', text: 'Hello from tntfy' });
  });

  it('classifies image/png as image + sendPhoto', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const r = dispatch('image/png', buf);
    expect(r).toMatchObject({ kind: 'image', method: 'sendPhoto', bytes: buf, mimeType: 'image/png' });
  });

  it('classifies image/jpeg, image/gif, image/webp', () => {
    for (const mime of ['image/jpeg', 'image/gif', 'image/webp']) {
      expect(dispatch(mime, Buffer.from([0]))).toMatchObject({ kind: 'image' });
    }
  });

  it('classifies application/octet-stream as file + sendDocument', () => {
    const buf = Buffer.from([1, 2, 3]);
    const r = dispatch('application/octet-stream', buf);
    expect(r).toMatchObject({ kind: 'file', method: 'sendDocument', bytes: buf, mimeType: 'application/octet-stream' });
  });

  it('classifies audio/* and video/* as file', () => {
    expect(dispatch('audio/mpeg', Buffer.from([0]))).toMatchObject({ kind: 'file' });
    expect(dispatch('video/mp4', Buffer.from([0]))).toMatchObject({ kind: 'file' });
  });

  it('throws UnsupportedContentTypeError for application/json', () => {
    expect(() => dispatch('application/json', Buffer.from('{}'))).toThrow(/unsupported_content_type/);
  });

  it('throws UnsupportedContentTypeError for empty/missing content-type', () => {
    expect(() => dispatch('', Buffer.from([0]))).toThrow();
  });

  it('honors parameters in content-type (charset, boundary)', () => {
    const r = dispatch('text/plain; charset=utf-8', 'hi');
    expect(r.kind).toBe('text');
  });
});
