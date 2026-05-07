import { describe, it, expect, vi } from 'vitest';
import { GrammyError } from 'grammy';
import { TelegramSender } from './telegram-sender.service';
import {
  TelegramBlockedError,
  TelegramThrottledError,
  TelegramFailedError,
  FormatError,
} from './errors';

function fakeGrammyError(code: number, description: string, parameters?: any) {
  const e: any = new Error(description);
  e.error_code = code;
  e.description = description;
  e.parameters = parameters;
  Object.setPrototypeOf(e, GrammyError.prototype);
  return e;
}

function makeSender(api: any) {
  return new TelegramSender({ api } as any);
}

describe('TelegramSender.sendText', () => {
  it('calls bot.api.sendMessage with parse_mode for HTML', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 42 });
    const sender = makeSender({ sendMessage });
    const out = await sender.sendText(100, '<b>x</b>', 'HTML');
    expect(sendMessage).toHaveBeenCalledWith(100, '<b>x</b>', { parse_mode: 'HTML' });
    expect(out.telegram_message_id).toBe(42);
  });

  it('omits parse_mode when parseMode is none', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 42 });
    const sender = makeSender({ sendMessage });
    await sender.sendText(100, 'plain', 'none');
    expect(sendMessage).toHaveBeenCalledWith(100, 'plain', {});
  });

  it('maps grammY 403 to TelegramBlockedError', async () => {
    const sendMessage = vi.fn().mockRejectedValue(fakeGrammyError(403, 'Forbidden: bot was blocked'));
    const sender = makeSender({ sendMessage });
    await expect(sender.sendText(100, 'x', 'none')).rejects.toThrow(TelegramBlockedError);
  });

  it('maps grammY 429 to TelegramThrottledError with retry_after', async () => {
    const sendMessage = vi.fn().mockRejectedValue(fakeGrammyError(429, 'Too Many', { retry_after: 30 }));
    const sender = makeSender({ sendMessage });
    await expect(sender.sendText(100, 'x', 'none')).rejects.toMatchObject({
      retryAfter: 30,
    });
  });

  it('maps grammY 400 parse error to FormatError', async () => {
    const sendMessage = vi.fn().mockRejectedValue(fakeGrammyError(400, "can't parse entities"));
    const sender = makeSender({ sendMessage });
    await expect(sender.sendText(100, 'x', 'MarkdownV2')).rejects.toThrow(FormatError);
  });
});

describe('TelegramSender.sendImage', () => {
  it('calls bot.api.sendPhoto with InputFile and caption', async () => {
    const sendPhoto = vi.fn().mockResolvedValue({ message_id: 7 });
    const sender = makeSender({ sendPhoto });
    const buf = Buffer.from([1, 2, 3]);
    await sender.sendImage(100, buf, 'pic.png', 'a caption');
    expect(sendPhoto).toHaveBeenCalledTimes(1);
    const [chat, file, opts] = sendPhoto.mock.calls[0]!;
    expect(chat).toBe(100);
    expect(file).toBeDefined();
    expect(opts).toMatchObject({ caption: 'a caption' });
  });
});

describe('TelegramSender.sendFile', () => {
  it('calls bot.api.sendDocument', async () => {
    const sendDocument = vi.fn().mockResolvedValue({ message_id: 9 });
    const sender = makeSender({ sendDocument });
    await sender.sendFile(100, Buffer.from([0]), 'data.bin');
    expect(sendDocument).toHaveBeenCalledTimes(1);
    expect(sendDocument.mock.calls[0]![0]).toBe(100);
  });

  it('maps generic 500 to TelegramFailedError', async () => {
    const sendDocument = vi.fn().mockRejectedValue(fakeGrammyError(500, 'Internal'));
    const sender = makeSender({ sendDocument });
    await expect(sender.sendFile(100, Buffer.from([0]), 'data.bin')).rejects.toBeInstanceOf(TelegramFailedError);
  });
});
