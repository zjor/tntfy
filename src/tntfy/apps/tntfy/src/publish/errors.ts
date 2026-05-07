import { GrammyError } from 'grammy';

export class MissingTokenError extends Error {
  readonly tag = 'missing_token';
  constructor() { super('missing_token'); }
}
export class InvalidTokenError extends Error {
  readonly tag = 'invalid_token';
  constructor() { super('invalid_token'); }
}
export class PathTopicMismatchError extends Error {
  readonly tag = 'topic_not_found';
  constructor() { super('topic_not_found'); }
}
export class EmptyBodyError extends Error {
  readonly tag = 'empty_body';
  constructor() { super('empty_body'); }
}
export class PayloadTooLargeError extends Error {
  readonly tag = 'payload_too_large';
  constructor(public readonly reason: string) { super(`payload_too_large: ${reason}`); }
}
export class FormatError extends Error {
  readonly tag = 'format_error';
  constructor(public readonly description: string) { super(`format_error: ${description}`); }
}
export class TelegramBlockedError extends Error {
  readonly tag = 'telegram_blocked';
  constructor() { super('telegram_blocked'); }
}
export class TelegramThrottledError extends Error {
  readonly tag = 'telegram_throttled';
  constructor(public readonly retryAfter: number) { super(`telegram_throttled: retry_after=${retryAfter}`); }
}
export class TelegramFailedError extends Error {
  readonly tag = 'telegram_failed';
  constructor(public readonly reason: string) { super(`telegram_failed: ${reason}`); }
}

const PARSE_HINT = /parse|markdown|html|entit/i;

export function mapGrammyError(err: unknown): unknown {
  if (!(err instanceof GrammyError)) return err;
  const code = err.error_code;
  const desc = err.description ?? '';
  if (code === 403) return new TelegramBlockedError();
  if (code === 429) {
    const retry = Number((err as any).parameters?.retry_after ?? 0);
    return new TelegramThrottledError(retry);
  }
  if (code === 400 && PARSE_HINT.test(desc)) return new FormatError(desc);
  return new TelegramFailedError(desc || `error_code=${code}`);
}
