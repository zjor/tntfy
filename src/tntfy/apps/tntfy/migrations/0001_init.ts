import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('ext_id', 'bigint', (col) => col.notNull().unique())
    .addColumn('username', 'text')
    .addColumn('first_name', 'text')
    .addColumn('last_name', 'text')
    .addColumn('created_at', sql`timestamptz`, (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', sql`timestamptz`)
    .execute();

  await db.schema
    .createTable('topics')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('user_id', 'text', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('created_at', sql`timestamptz`, (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('topics_user_id_name_unique', ['user_id', 'name'])
    .execute();

  await db.schema
    .createTable('topic_tokens')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('topic_id', 'text', (col) =>
      col.notNull().references('topics.id').onDelete('cascade'),
    )
    .addColumn('token', 'text', (col) => col.notNull().unique())
    .addColumn('created_at', sql`timestamptz`, (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('topic_tokens_topic_id_idx')
    .on('topic_tokens')
    .column('topic_id')
    .execute();

  await db.schema
    .createTable('topic_messages')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('topic_id', 'text', (col) =>
      col.notNull().references('topics.id').onDelete('cascade'),
    )
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('format', 'text')
    .addColumn('text_body', 'text')
    .addColumn('mime_type', 'text')
    .addColumn('content_length', 'bigint')
    .addColumn('filename', 'text')
    .addColumn('caption', 'text')
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('telegram_message_id', 'bigint')
    .addColumn('error', 'text')
    .addColumn('created_at', sql`timestamptz`, (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    create index topic_messages_topic_id_created_at_idx
      on topic_messages (topic_id, created_at desc)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('topic_messages').ifExists().execute();
  await db.schema.dropTable('topic_tokens').ifExists().execute();
  await db.schema.dropTable('topics').ifExists().execute();
  await db.schema.dropTable('users').ifExists().execute();
}
