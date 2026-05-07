import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { nanoid } from 'nanoid';
import { KYSELY } from '../database/database.module';
import type { Database } from '../database/schema';

export interface RecordAttemptInput {
  topicId: string;
  kind: 'text' | 'image' | 'file';
  format: 'text' | 'markdown' | 'html' | null;
  textBody: string | null;
  mimeType: string | null;
  contentLength: number | null;
  filename: string | null;
  caption: string | null;
  status: 'delivered' | 'failed';
  telegramMessageId: number | null;
  error: string | null;
}

@Injectable()
export class MessagesService {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  async recordAttempt(input: RecordAttemptInput): Promise<{ id: string }> {
    const id = nanoid();
    await this.db
      .insertInto('topic_messages')
      .values({
        id,
        topic_id: input.topicId,
        kind: input.kind,
        format: input.format,
        text_body: input.textBody,
        mime_type: input.mimeType,
        content_length: input.contentLength,
        filename: input.filename,
        caption: input.caption,
        status: input.status,
        telegram_message_id: input.telegramMessageId,
        error: input.error,
      })
      .execute();
    return { id };
  }
}
