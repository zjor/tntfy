import { describe, it, expect, vi } from 'vitest';
import { LogUpdateMiddleware } from './log-update.middleware';

function makeMw(loggerLog = vi.fn()) {
  const logger: any = { log: loggerLog };
  return { mw: new LogUpdateMiddleware(logger), loggerLog };
}

describe('LogUpdateMiddleware', () => {
  it('logs a message update with text', async () => {
    const { mw, loggerLog } = makeMw();
    const ctx: any = {
      update: { update_id: 42 },
      from: { id: 100, username: 'alice' },
      message: { text: 'hello' },
      user: { id: 'u_x', ext_id: 100 },
    };
    const next = vi.fn(async () => {});
    await mw.middleware()(ctx, next);

    expect(loggerLog).toHaveBeenCalledTimes(1);
    const [payload, msg, context] = loggerLog.mock.calls[0]!;
    expect(payload).toMatchObject({
      update_id: 42,
      ext_id: 100,
      user_id: 'u_x',
      username: 'alice',
      type: 'message',
      text: 'hello',
      callback_data: undefined,
    });
    expect(msg).toBe('bot.update');
    expect(context).toBe('BotModule');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('logs a callback_query update', async () => {
    const { mw, loggerLog } = makeMw();
    const ctx: any = {
      update: { update_id: 7 },
      from: { id: 200, username: 'bob' },
      callbackQuery: { id: 'cq1', data: 'topic-remove:y:t_abc' },
      user: { id: 'u_y', ext_id: 200 },
    };
    const next = vi.fn(async () => {});
    await mw.middleware()(ctx, next);

    const [payload] = loggerLog.mock.calls[0]!;
    expect(payload).toMatchObject({
      update_id: 7,
      ext_id: 200,
      type: 'callback_query',
      callback_data: 'topic-remove:y:t_abc',
      text: undefined,
    });
  });

  it('truncates long text to 500 chars + ellipsis', async () => {
    const { mw, loggerLog } = makeMw();
    const long = 'a'.repeat(600);
    const ctx: any = {
      update: { update_id: 1 },
      from: { id: 1 },
      message: { text: long },
    };
    await mw.middleware()(ctx, vi.fn(async () => {}));

    const [payload] = loggerLog.mock.calls[0]!;
    expect(payload.text).toHaveLength(501); // 500 + "…"
    expect(payload.text.endsWith('…')).toBe(true);
  });

  it('still calls next when from/message are missing (non-user updates)', async () => {
    const { mw } = makeMw();
    const ctx: any = { update: { update_id: 1 } };
    const next = vi.fn(async () => {});
    await mw.middleware()(ctx, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('uses type=other for updates that are neither messages nor callback queries', async () => {
    const { mw, loggerLog } = makeMw();
    const ctx: any = { update: { update_id: 1 }, from: { id: 1 } };
    await mw.middleware()(ctx, vi.fn(async () => {}));
    const [payload] = loggerLog.mock.calls[0]!;
    expect(payload.type).toBe('other');
  });
});
