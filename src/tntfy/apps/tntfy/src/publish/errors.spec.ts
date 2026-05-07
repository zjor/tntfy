import { describe, it, expect } from 'vitest';
import { GrammyError } from 'grammy';
import {
  MissingTokenError,
  InvalidTokenError,
  PathTopicMismatchError,
  EmptyBodyError,
  PayloadTooLargeError,
  TelegramBlockedError,
  TelegramThrottledError,
  TelegramFailedError,
  FormatError,
  mapGrammyError,
} from './errors';

function ge(code: number, description: string, parameters?: any) {
  // Construct a GrammyError-shaped object — the real class requires extra fields
  // but our mapper reads only error_code/description/parameters.
  const e: any = new Error(description);
  e.error_code = code;
  e.description = description;
  e.parameters = parameters;
  Object.setPrototypeOf(e, GrammyError.prototype);
  return e;
}

describe('publish error classes', () => {
  it('all extend Error and carry their tag', () => {
    expect(new MissingTokenError()).toBeInstanceOf(Error);
    expect(new InvalidTokenError()).toBeInstanceOf(Error);
    expect(new PathTopicMismatchError()).toBeInstanceOf(Error);
    expect(new EmptyBodyError()).toBeInstanceOf(Error);
    expect(new PayloadTooLargeError('over 4096 chars')).toBeInstanceOf(Error);
    expect(new TelegramBlockedError()).toBeInstanceOf(Error);
    expect(new TelegramThrottledError(30)).toMatchObject({ retryAfter: 30 });
    expect(new TelegramFailedError('boom')).toMatchObject({ reason: 'boom' });
    expect(new FormatError('parse error')).toBeInstanceOf(Error);
  });
});

describe('mapGrammyError', () => {
  it('403 → TelegramBlockedError', () => {
    expect(mapGrammyError(ge(403, 'Forbidden: bot was blocked by the user'))).toBeInstanceOf(TelegramBlockedError);
  });

  it('429 → TelegramThrottledError with retry_after', () => {
    const e = mapGrammyError(ge(429, 'Too Many Requests', { retry_after: 30 }));
    expect(e).toBeInstanceOf(TelegramThrottledError);
    expect((e as TelegramThrottledError).retryAfter).toBe(30);
  });

  it('400 with parse-related description → FormatError', () => {
    expect(mapGrammyError(ge(400, "Bad Request: can't parse entities"))).toBeInstanceOf(FormatError);
    expect(mapGrammyError(ge(400, 'Bad Request: invalid markdown'))).toBeInstanceOf(FormatError);
    expect(mapGrammyError(ge(400, 'Bad Request: invalid html'))).toBeInstanceOf(FormatError);
  });

  it('400 unrelated → TelegramFailedError', () => {
    expect(mapGrammyError(ge(400, 'Bad Request: PHOTO_INVALID_DIMENSIONS'))).toBeInstanceOf(TelegramFailedError);
  });

  it('500/other → TelegramFailedError with description as reason', () => {
    const e = mapGrammyError(ge(500, 'Internal Server Error'));
    expect(e).toBeInstanceOf(TelegramFailedError);
    expect((e as TelegramFailedError).reason).toBe('Internal Server Error');
  });

  it('non-GrammyError passes through unchanged', () => {
    const original = new Error('something else');
    expect(mapGrammyError(original)).toBe(original);
  });
});
