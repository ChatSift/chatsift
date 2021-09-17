import { kLogger, kRedis } from '@automoderator/injection';
import type { APIMessage, Snowflake } from 'discord-api-types/v9';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';

@singleton()
export class MentionsRunner {
  public readonly mentionsRegex = /<@!?&?(?<id>\d{17,19})>/g;

  public constructor(
    @inject(kLogger) public readonly logger: Logger,
    @inject(kRedis) public readonly redis: Redis
  ) {}

  public mentionsFromMessage(content: string): Snowflake[] {
    return [...content.matchAll(this.mentionsRegex)].map(match => match.groups!.id!);
  }

  public precheck(content: string): boolean {
    return this.mentionsFromMessage(content).length > 0;
  }

  private async runMentionSpam(message: APIMessage, amount: number, time: number): Promise<Snowflake[]> {
    const key = `anti_mention_spam_${message.guild_id!}_${message.author.id}`;
    const messageMentions = this.mentionsFromMessage(message.content);

    const pipe = this.redis.pipeline();
    for (const mention of messageMentions) {
      pipe.zadd(key, Date.now(), `${message.id}|${mention}`);
    }

    await pipe.exec();

    await this.redis.expire(key, time);

    const data = await this.redis.zrangebyscore(key, Date.now() - (time * 1000), Date.now());
    const { messages, mentions } = data.reduce<{ messages: string[]; mentions: string[] }>((acc, entry) => {
      const [message, mention] = entry.split('|') as [string, string];
      acc.messages.push(message);
      acc.mentions.push(mention);

      return acc;
    }, { messages: [], mentions: [] });

    if (mentions.length >= amount) {
      await this.redis.del(key);
      return [...new Set(messages)];
    }

    return [];
  }

  private runMentionLimit(message: APIMessage, limit: number): Snowflake[] {
    return this.mentionsFromMessage(message.content).length >= limit ? [message.id] : [];
  }

  public async run(message: APIMessage, amount?: number | null, time?: number | null, limit?: number | null) {
    if (limit) {
      const messages = this.runMentionLimit(message, limit);
      if (messages.length) {
        return messages;
      }
    }

    if (amount && time) {
      return this.runMentionSpam(message, amount, time);
    }

    this.logger.warn({ amount, time, limit }, 'Something went wrong running mentions filters');
    throw new TypeError('Expected either limit OR amount AND time');
  }
}
