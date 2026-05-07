import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
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

@Catch()
export class PublishExceptionFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (err instanceof MissingTokenError) return void res.status(401).json({ error: 'missing_token' });
    if (err instanceof InvalidTokenError) return void res.status(401).json({ error: 'invalid_token' });
    if (err instanceof PathTopicMismatchError) return void res.status(404).json({ error: 'topic_not_found' });
    if (err instanceof EmptyBodyError) return void res.status(400).json({ error: 'empty_body' });
    if (err instanceof FormatError) return void res.status(400).json({ error: 'format_error', description: err.description });
    if (err instanceof PayloadTooLargeError) return void res.status(413).json({ error: 'payload_too_large', reason: err.reason });
    if (err instanceof UnsupportedContentTypeError) {
      return void res.status(415).json({ error: 'unsupported_content_type', content_type: err.contentType });
    }
    if (err instanceof TelegramBlockedError) return void res.status(502).json({ error: 'telegram_blocked' });
    if (err instanceof TelegramThrottledError) {
      return void res.status(502).json({ error: 'telegram_throttled', retry_after: err.retryAfter });
    }
    if (err instanceof TelegramFailedError) return void res.status(502).json({ error: 'telegram_failed', reason: err.reason });

    // express bodyParser PayloadTooLargeError
    const e = err as any;
    if (e?.type === 'entity.too.large' || e?.status === 413) {
      return void res.status(413).json({ error: 'payload_too_large' });
    }

    res.status(500).json({ error: 'internal_error' });
  }
}
