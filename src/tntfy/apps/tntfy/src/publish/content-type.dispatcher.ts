export class UnsupportedContentTypeError extends Error {
  constructor(public readonly contentType: string) {
    super(`unsupported_content_type: ${contentType || '<missing>'}`);
  }
}

export type DispatchResult =
  | { kind: 'text'; method: 'sendMessage'; parseMode: 'none' | 'MarkdownV2' | 'HTML'; text: string }
  | { kind: 'image'; method: 'sendPhoto'; bytes: Buffer; mimeType: string }
  | { kind: 'file'; method: 'sendDocument'; bytes: Buffer; mimeType: string };

function baseType(contentType: string): string {
  return (contentType || '').split(';')[0]!.trim().toLowerCase();
}

export function dispatch(contentType: string, body: string | Buffer): DispatchResult {
  const ct = baseType(contentType);

  // curl -d "..." defaults to application/x-www-form-urlencoded — treat it as
  // plaintext so the marquee one-liner from the PRD just works.
  if (ct === 'text/plain' || ct === 'application/x-www-form-urlencoded') {
    return { kind: 'text', method: 'sendMessage', parseMode: 'none', text: body as string };
  }
  if (ct === 'text/markdown') return { kind: 'text', method: 'sendMessage', parseMode: 'MarkdownV2', text: body as string };
  if (ct === 'text/html') return { kind: 'text', method: 'sendMessage', parseMode: 'HTML', text: body as string };

  if (ct.startsWith('image/')) return { kind: 'image', method: 'sendPhoto', bytes: body as Buffer, mimeType: ct };
  if (ct === 'application/octet-stream' || ct.startsWith('audio/') || ct.startsWith('video/')) {
    return { kind: 'file', method: 'sendDocument', bytes: body as Buffer, mimeType: ct };
  }

  throw new UnsupportedContentTypeError(ct);
}
