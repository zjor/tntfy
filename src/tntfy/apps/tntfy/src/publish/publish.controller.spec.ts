import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import express from 'express';
import request from 'supertest';
import { PublishModule } from './publish.module';
import { TopicsService } from '../topics/topics.service';
import { UsersService } from '../users/users.service';
import { UsersModule } from '../users/users.module';
import { TelegramSender } from './telegram-sender.service';
import { KYSELY, DatabaseModule } from '../database/database.module';
import { AuditLogger } from '../logging/audit.service';
import { getTestDb } from '../../test/db';

let app: INestApplication;
let token: string;
let topicId: string;
let sender: { sendText: any; sendImage: any; sendFile: any };

beforeEach(async () => {
  const audit = { log: () => {}, fail: () => {} };
  sender = {
    sendText: vi.fn().mockResolvedValue({ telegram_message_id: 100 }),
    sendImage: vi.fn().mockResolvedValue({ telegram_message_id: 200 }),
    sendFile: vi.fn().mockResolvedValue({ telegram_message_id: 300 }),
  };

  const mod = await Test.createTestingModule({
    imports: [DatabaseModule, UsersModule, PublishModule],
  })
    .overrideProvider(KYSELY)
    .useFactory({ factory: () => getTestDb() })
    .overrideProvider(AuditLogger)
    .useValue(audit)
    .overrideProvider(TelegramSender)
    .useValue(sender)
    .compile();

  app = mod.createNestApplication();
  app.use(
    '/publish',
    express.text({ type: ['text/plain', 'text/markdown', 'text/html'], limit: '64kb' }),
  );
  app.use(
    '/publish',
    express.raw({
      type: ['application/octet-stream', 'image/*', 'audio/*', 'video/*'],
      limit: '50mb',
    }),
  );
  app.use('/publish', (err: any, _req: any, res: any, next: any) => {
    if (err?.type === 'entity.too.large' || err?.status === 413) {
      return res.status(413).json({ error: 'payload_too_large' });
    }
    next(err);
  });
  await app.init();

  const users = app.get(UsersService);
  const topics = app.get(TopicsService);
  const u = await users.createOrGet({ id: 100, username: null, first_name: null, last_name: null });
  const created = await topics.create(u.id, 'deploys');
  token = created.token;
  topicId = created.topic.id;
});

describe('POST /publish/:topic — happy paths', () => {
  it('text/plain → sendMessage parse_mode none → 200', async () => {
    const res = await request(app.getHttpServer())
      .post('/publish/deploys')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send('Backup successful');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      topic: 'deploys',
      telegram_message_id: 100,
    });
    expect(res.body.id).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(sender.sendText).toHaveBeenCalledWith(100, 'Backup successful', 'none');
    const db = app.get<any>(KYSELY);
    const row = await db.selectFrom('topic_messages').selectAll().where('id', '=', res.body.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ kind: 'text', format: 'text', status: 'delivered', text_body: 'Backup successful' });
  });

  it('text/markdown → MarkdownV2', async () => {
    const res = await request(app.getHttpServer())
      .post('/publish/deploys')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/markdown')
      .send('hello *bold*');
    expect(res.status).toBe(200);
    expect(sender.sendText).toHaveBeenCalledWith(100, 'hello *bold*', 'MarkdownV2');
  });

  it('text/html → HTML', async () => {
    const res = await request(app.getHttpServer())
      .post('/publish/deploys')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/html')
      .send('<b>x</b>');
    expect(res.status).toBe(200);
    expect(sender.sendText).toHaveBeenCalledWith(100, '<b>x</b>', 'HTML');
  });

  it('image/png → sendPhoto with provided Filename', async () => {
    const res = await request(app.getHttpServer())
      .post('/publish/deploys')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'image/png')
      .set('Filename', 'screenshot.png')
      .set('Caption', 'see attached')
      .send(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ topic: 'deploys', telegram_message_id: 200 });
    expect(sender.sendImage).toHaveBeenCalledWith(
      100,
      expect.any(Buffer),
      'screenshot.png',
      'see attached',
    );
  });

  it('application/octet-stream → sendDocument with generated filename', async () => {
    const res = await request(app.getHttpServer())
      .post('/publish/deploys')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from([1, 2, 3, 4]));
    expect(res.status).toBe(200);
    expect(sender.sendFile).toHaveBeenCalledTimes(1);
    const args = sender.sendFile.mock.calls[0]!;
    expect(args[0]).toBe(100);
    expect(args[2]).toMatch(/^attachment-[A-Za-z0-9_-]{8}\.bin$/);
  });
});
