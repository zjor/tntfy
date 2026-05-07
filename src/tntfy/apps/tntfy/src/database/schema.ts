import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface UsersTable {
  id: string;
  ext_id: number | bigint;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  created_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface TopicsTable {
  id: string;
  user_id: string;
  name: string;
  created_at: Generated<Timestamp>;
}

export interface TopicTokensTable {
  id: string;
  topic_id: string;
  token: string;
  created_at: Generated<Timestamp>;
}

export type MessageKind = 'text' | 'image' | 'file';
export type MessageFormat = 'text' | 'markdown' | 'html';
export type MessageStatus = 'delivered' | 'failed';

export interface TopicMessagesTable {
  id: string;
  topic_id: string;
  kind: MessageKind;
  format: MessageFormat | null;
  text_body: string | null;
  mime_type: string | null;
  content_length: number | bigint | null;
  filename: string | null;
  caption: string | null;
  status: MessageStatus;
  telegram_message_id: number | bigint | null;
  error: string | null;
  created_at: Generated<Timestamp>;
}

export interface Database {
  users: UsersTable;
  topics: TopicsTable;
  topic_tokens: TopicTokensTable;
  topic_messages: TopicMessagesTable;
}
