import { customAlphabet } from 'nanoid';

const SHORT_ID = customAlphabet(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
  8,
);

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export function mimeToExt(mime: string): string {
  return MIME_EXT[mime] ?? 'bin';
}

export function resolveFilename(input: { filename?: string; mimeType: string }): string {
  const trimmed = input.filename?.trim();
  if (trimmed) return trimmed;
  return `attachment-${SHORT_ID()}.${mimeToExt(input.mimeType)}`;
}
