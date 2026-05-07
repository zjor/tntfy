import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

/**
 * Audit events emitted for state-changing operations. Shape matches the table
 * in docs/project/prd.md §Audit logging. Bodies and tokens are never included.
 */
export type AuditEvent =
  | { op: 'user.create_or_get'; user_id: string; ext_id: number }
  | { op: 'topic.create'; user_id: string; topic_id: string; name: string }
  | { op: 'token.rotate'; user_id: string; topic_id: string }
  | {
      op: 'topic.delete';
      user_id: string;
      topic_id: string;
      name: string;
      cascaded_messages_count: number;
    }
  | {
      op: 'message.publish';
      user_id: string;
      topic_id: string;
      message_id: string;
      kind: 'text' | 'image' | 'file';
      status: 'delivered' | 'failed';
      telegram_message_id?: number;
      bytes?: number;
      latency_ms: number;
    };

@Injectable()
export class AuditLogger {
  constructor(
    @InjectPinoLogger(AuditLogger.name) private readonly logger: PinoLogger,
  ) {}

  log(event: AuditEvent): void {
    this.logger.info(event, 'audit');
  }

  fail(event: AuditEvent & { error: string }): void {
    this.logger.error(event, 'audit');
  }
}
