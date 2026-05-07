import { describe, it, expect, vi } from 'vitest';
import { ArgumentsHost } from '@nestjs/common';
import { PublishExceptionFilter } from './error.filter';
import {
  MissingTokenError,
  InvalidTokenError,
  PathTopicMismatchError,
  EmptyBodyError,
  PayloadTooLargeError,
  FormatError,
  TelegramBlockedError,
  TelegramThrottledError,
  TelegramFailedError,
} from './errors';
import { UnsupportedContentTypeError } from './content-type.dispatcher';

function makeHost(): { host: ArgumentsHost; status: any; json: any } {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn();
  const res = { status, json };
  const host: any = {
    switchToHttp: () => ({ getResponse: () => res }),
  };
  return { host: host as ArgumentsHost, status, json };
}

describe('PublishExceptionFilter', () => {
  const filter = new PublishExceptionFilter();

  it.each([
    [new MissingTokenError(), 401, { error: 'missing_token' }],
    [new InvalidTokenError(), 401, { error: 'invalid_token' }],
    [new PathTopicMismatchError(), 404, { error: 'topic_not_found' }],
    [new EmptyBodyError(), 400, { error: 'empty_body' }],
    [new FormatError("can't parse entities"), 400, { error: 'format_error' }],
    [new PayloadTooLargeError('text > 4096'), 413, { error: 'payload_too_large' }],
    [new UnsupportedContentTypeError('application/json'), 415, { error: 'unsupported_content_type' }],
    [new TelegramBlockedError(), 502, { error: 'telegram_blocked' }],
    [new TelegramFailedError('boom'), 502, { error: 'telegram_failed', reason: 'boom' }],
  ])('maps %o to status/body', (err, statusCode, bodyShape) => {
    const { host, status, json } = makeHost();
    filter.catch(err, host);
    expect(status).toHaveBeenCalledWith(statusCode);
    expect(json).toHaveBeenCalledWith(expect.objectContaining(bodyShape));
  });

  it('telegram_throttled includes retry_after', () => {
    const { host, status, json } = makeHost();
    filter.catch(new TelegramThrottledError(42), host);
    expect(status).toHaveBeenCalledWith(502);
    expect(json).toHaveBeenCalledWith({ error: 'telegram_throttled', retry_after: 42 });
  });

  it('PayloadTooLargeError-from-bodyParser (express type) maps to 413', () => {
    const expressErr: any = new Error('request entity too large');
    expressErr.type = 'entity.too.large';
    expressErr.status = 413;
    const { host, status, json } = makeHost();
    filter.catch(expressErr, host);
    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith({ error: 'payload_too_large' });
  });

  it('falls back to 500 internal_error for unknown', () => {
    const { host, status, json } = makeHost();
    filter.catch(new Error('boom'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'internal_error' });
  });
});
