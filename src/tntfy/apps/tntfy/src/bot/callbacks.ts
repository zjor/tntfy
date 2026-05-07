import { Injectable } from '@nestjs/common';
import { Update, On, Ctx } from '@grammyjs/nestjs';
import { TopicsService } from '../topics/topics.service';
import { TopicNotFoundError } from '../topics/errors';
import type { AppContext } from './context';

@Update()
@Injectable()
export class Callbacks {
  constructor(private readonly topics: TopicsService) {}

  @On('callback_query:data')
  async onTopicRemoveCallback(@Ctx() ctx: AppContext) {
    const data = ctx.callbackQuery?.data ?? '';
    if (!data.startsWith('topic-remove:')) return;
    const [, action, topicId] = data.split(':');
    if (!ctx.user || !topicId) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (action === 'n') {
      await ctx.editMessageText('Cancelled.');
      await ctx.answerCallbackQuery();
      return;
    }
    if (action === 'y') {
      try {
        const result = await this.topics.removeById(ctx.user.id, topicId);
        await ctx.editMessageText(`Removed topic '${result.name}'.`);
      } catch (err) {
        if (err instanceof TopicNotFoundError) {
          await ctx.editMessageText('That topic no longer exists or is not yours.');
        } else {
          await ctx.editMessageText('Something went wrong, try again later.');
        }
      } finally {
        await ctx.answerCallbackQuery();
      }
      return;
    }
    await ctx.answerCallbackQuery();
  }
}
