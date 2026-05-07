import { Injectable } from '@nestjs/common';
import { Bot, InputFile } from 'grammy';
import { InjectBot } from '@grammyjs/nestjs';
import type { AppContext } from '../bot/context';
import { mapGrammyError } from './errors';

@Injectable()
export class TelegramSender {
  constructor(@InjectBot() private readonly bot: Bot<AppContext>) {}

  async sendText(
    chatId: number,
    text: string,
    parseMode: 'MarkdownV2' | 'HTML' | 'none',
  ): Promise<{ telegram_message_id: number }> {
    const opts = parseMode === 'none' ? {} : { parse_mode: parseMode };
    try {
      const msg = await this.bot.api.sendMessage(chatId, text, opts);
      return { telegram_message_id: msg.message_id };
    } catch (err) {
      throw mapGrammyError(err);
    }
  }

  async sendImage(
    chatId: number,
    bytes: Buffer,
    filename: string,
    caption?: string,
  ): Promise<{ telegram_message_id: number }> {
    try {
      const msg = await this.bot.api.sendPhoto(
        chatId,
        new InputFile(bytes, filename),
        caption ? { caption } : {},
      );
      return { telegram_message_id: msg.message_id };
    } catch (err) {
      throw mapGrammyError(err);
    }
  }

  async sendFile(
    chatId: number,
    bytes: Buffer,
    filename: string,
    caption?: string,
  ): Promise<{ telegram_message_id: number }> {
    try {
      const msg = await this.bot.api.sendDocument(
        chatId,
        new InputFile(bytes, filename),
        caption ? { caption } : {},
      );
      return { telegram_message_id: msg.message_id };
    } catch (err) {
      throw mapGrammyError(err);
    }
  }
}
