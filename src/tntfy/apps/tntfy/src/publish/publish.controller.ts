import {
  Controller, Headers, HttpCode, Post, Req, UseFilters, UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiHeader, ApiOperation, ApiParam,
  ApiOkResponse, ApiUnauthorizedResponse, ApiNotFoundResponse,
  ApiBadRequestResponse, ApiRequestTimeoutResponse, ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { TelegramSender } from './telegram-sender.service';
import { MessagesService } from './messages.service';
import { AuthGuard } from './auth.guard';
import { CurrentTopic } from './current-topic.decorator';
import type { TopicContext } from './topic-context';
import { dispatch } from './content-type.dispatcher';
import { resolveFilename } from './filename';
import { formatText, formatCaption } from './format-message';
import { PublishExceptionFilter } from './error.filter';
import { EmptyBodyError, PayloadTooLargeError } from './errors';
import { AuditLogger } from '../logging/audit.service';

const TG_TEXT_MAX = 4096;
const TG_CAPTION_MAX = 1024;

@ApiTags('publish')
@ApiBearerAuth('topic-token')
@Controller('publish')
@UseGuards(AuthGuard)
@UseFilters(PublishExceptionFilter)
export class PublishController {
  constructor(
    private readonly sender: TelegramSender,
    private readonly messages: MessagesService,
    private readonly audit: AuditLogger,
  ) {}

  @Post(':topic')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publish a message to a topic' })
  @ApiParam({ name: 'topic', description: 'Topic name', example: 'my-alerts' })
  @ApiHeader({ name: 'caption', required: false, description: 'Caption for image/file payloads (max 1024 chars)' })
  @ApiHeader({ name: 'filename', required: false, description: 'Override filename for file payloads' })
  @ApiOkResponse({ schema: { example: { id: 'abc123', topic: 'my-alerts', telegram_message_id: 42, delivered_at: '2026-05-09T12:00:00.000Z' } } })
  @ApiUnauthorizedResponse({ schema: { example: { error: 'unauthorized' } } })
  @ApiNotFoundResponse({ schema: { example: { error: 'topic_not_found' } } })
  @ApiBadRequestResponse({ schema: { example: { error: 'empty_body' } } })
  @ApiRequestTimeoutResponse({ schema: { example: { error: 'telegram_throttled' } } })
  async publish(
    @CurrentTopic() ctx: TopicContext,
    @Headers() headers: Record<string, string>,
    @Req() req: Request,
  ) {
    const start = Date.now();
    const contentType = headers['content-type'] ?? '';
    const body = req.body as string | Buffer;
    const filenameHeader = headers['filename'];
    const caption = headers['caption'];

    const result = dispatch(contentType, body);

    if (result.kind === 'text') {
      const text = result.text ?? '';
      if (text.length === 0) throw new EmptyBodyError();
      const composed = formatText(ctx.topic_name, text, result.parseMode);
      if (composed.length > TG_TEXT_MAX) throw new PayloadTooLargeError(`text > ${TG_TEXT_MAX}`);

      const format = result.parseMode === 'MarkdownV2' ? 'markdown' : result.parseMode === 'HTML' ? 'html' : 'text';
      let telegramMessageId: number | null = null;
      let status: 'delivered' | 'failed' = 'delivered';
      let errorStr: string | null = null;
      try {
        const r = await this.sender.sendText(ctx.chat_id, composed, result.parseMode);
        telegramMessageId = r.telegram_message_id;
      } catch (err: any) {
        status = 'failed';
        errorStr = err?.tag ?? err?.message ?? 'unknown';
        const recorded = await this.messages.recordAttempt({
          topicId: ctx.topic_id,
          kind: 'text', format, textBody: text,
          mimeType: null, contentLength: null, filename: null, caption: null,
          status, telegramMessageId: null, error: errorStr,
        });
        this.audit.log({
          op: 'message.publish', user_id: ctx.user_id, topic_id: ctx.topic_id,
          message_id: recorded.id, kind: 'text', status: 'failed',
          bytes: Buffer.byteLength(text), latency_ms: Date.now() - start,
        });
        throw err;
      }
      const recorded = await this.messages.recordAttempt({
        topicId: ctx.topic_id,
        kind: 'text', format, textBody: text,
        mimeType: null, contentLength: null, filename: null, caption: null,
        status, telegramMessageId, error: errorStr,
      });
      this.audit.log({
        op: 'message.publish', user_id: ctx.user_id, topic_id: ctx.topic_id,
        message_id: recorded.id, kind: 'text', status: 'delivered',
        telegram_message_id: telegramMessageId!, bytes: Buffer.byteLength(text),
        latency_ms: Date.now() - start,
      });
      return {
        id: recorded.id, topic: ctx.topic_name,
        telegram_message_id: telegramMessageId, delivered_at: new Date().toISOString(),
      };
    }

    // image or file
    const bytes = result.bytes;
    const composedCaption = formatCaption(ctx.topic_name, caption);
    if (composedCaption.length > TG_CAPTION_MAX) {
      throw new PayloadTooLargeError(`caption > ${TG_CAPTION_MAX}`);
    }
    const filename = resolveFilename({ filename: filenameHeader, mimeType: result.mimeType });
    const kind = result.kind;

    let telegramMessageId: number | null = null;
    let status: 'delivered' | 'failed' = 'delivered';
    let errorStr: string | null = null;
    try {
      const r = kind === 'image'
        ? await this.sender.sendImage(ctx.chat_id, bytes, filename, composedCaption)
        : await this.sender.sendFile(ctx.chat_id, bytes, filename, composedCaption);
      telegramMessageId = r.telegram_message_id;
    } catch (err: any) {
      status = 'failed';
      errorStr = err?.tag ?? err?.message ?? 'unknown';
      const recorded = await this.messages.recordAttempt({
        topicId: ctx.topic_id,
        kind, format: null, textBody: null,
        mimeType: result.mimeType, contentLength: bytes.length,
        filename, caption: caption ?? null,
        status, telegramMessageId: null, error: errorStr,
      });
      this.audit.log({
        op: 'message.publish', user_id: ctx.user_id, topic_id: ctx.topic_id,
        message_id: recorded.id, kind, status: 'failed',
        bytes: bytes.length, latency_ms: Date.now() - start,
      });
      throw err;
    }
    const recorded = await this.messages.recordAttempt({
      topicId: ctx.topic_id,
      kind, format: null, textBody: null,
      mimeType: result.mimeType, contentLength: bytes.length,
      filename, caption: caption ?? null,
      status, telegramMessageId, error: errorStr,
    });
    this.audit.log({
      op: 'message.publish', user_id: ctx.user_id, topic_id: ctx.topic_id,
      message_id: recorded.id, kind, status: 'delivered',
      telegram_message_id: telegramMessageId!, bytes: bytes.length,
      latency_ms: Date.now() - start,
    });
    return {
      id: recorded.id, topic: ctx.topic_name,
      telegram_message_id: telegramMessageId, delivered_at: new Date().toISOString(),
    };
  }
}
