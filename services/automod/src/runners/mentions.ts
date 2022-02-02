import type { Log, MentionsRunnerResult } from '@automoderator/broker-types';
import { MessageCache } from '@automoderator/cache';
import { kRedis } from '@automoderator/injection';
import { dmUser } from '@automoderator/util';
import { groupBy } from '@chatsift/utils';
import { PubSubPublisher } from '@cordis/brokers';
import { Rest } from '@cordis/rest';
import { PrismaClient } from '@prisma/client';
import { Routes, APIMessage, Snowflake, RESTPostAPIChannelMessagesBulkDeleteJSONBody } from 'discord-api-types/v9';
import type { Redis } from 'ioredis';
import { inject, singleton } from 'tsyringe';
import type { IRunner } from './IRunner';

interface MentionsTransform {
	message: APIMessage;
	mentions: Snowflake[];
	amount?: number | null;
	time?: number | null;
	limit?: number | null;
}

@singleton()
export class MentionsRunner implements IRunner<MentionsTransform, APIMessage | APIMessage[], MentionsRunnerResult> {
	public readonly mentionsRegex = /<@!?&?(?<id>\d{17,19})>/g;

	public constructor(
		@inject(kRedis) public readonly redis: Redis,
		public readonly prisma: PrismaClient,
		public readonly messages: MessageCache,
		public readonly discord: Rest,
		public readonly logs: PubSubPublisher<Log>,
	) {}

	public async transform(message: APIMessage): Promise<MentionsTransform> {
		const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: message.guild_id } });

		return {
			message,
			mentions: [...message.content.matchAll(this.mentionsRegex)].map((match) => match.groups!.id!),
			amount: settings?.mentionAmount,
			time: settings?.mentionTime,
			limit: settings?.mentionLimit,
		};
	}

	public check({ amount, time, limit, mentions }: MentionsTransform): boolean {
		return ((amount != null && time != null) || limit != null) && mentions.length > 0;
	}

	public async run({
		message,
		mentions,
		amount,
		limit,
		time,
	}: MentionsTransform): Promise<APIMessage | APIMessage[] | null> {
		if (limit && mentions.length > limit) {
			return message;
		}

		if (amount && time) {
			const key = `anti_mention_spam_${message.guild_id!}_${message.author.id}`;
			const pipe = this.redis.pipeline();

			for (const mention of mentions) {
				pipe.zadd(key, Date.now(), `${message.id}|${mention}`);
			}

			await pipe.exec();
			await this.redis.expire(key, time);

			const data = await this.redis.zrangebyscore(key, Date.now() - time * 1000, Date.now());
			const { messages, mentions: postedMentions } = data.reduce<{ messages: string[]; mentions: string[] }>(
				(acc, entry) => {
					const [message, mention] = entry.split('|') as [string, string];
					acc.messages.push(message);
					acc.mentions.push(mention);

					return acc;
				},
				{ messages: [], mentions: [] },
			);

			if (postedMentions.length >= amount) {
				await this.redis.del(key);
				return (await Promise.all([...new Set(messages)].map((id) => this.messages.get(id)))).filter(
					(message): message is APIMessage => Boolean(message),
				);
			}
		}

		return null;
	}

	public async cleanup(messages: APIMessage | APIMessage[]): Promise<void> {
		messages = Array.isArray(messages) ? messages : [messages];

		const grouped = groupBy(messages, (message) => message.channel_id);
		const promises = [];

		for (const [channel, messages] of Object.entries(grouped)) {
			const message = messages[0]!;

			promises.push(
				messages.length === 1
					? this.discord
							.delete(Routes.channelMessage(channel, message.id), { reason: 'Anti mention spam trigger' })
							.then(() => dmUser(message.author.id, 'Be careful! You have been caught by anti-spam measures.'))
							.catch(() => null)
					: this.discord
							.post<never, RESTPostAPIChannelMessagesBulkDeleteJSONBody>(Routes.channelBulkDelete(channel), {
								data: {
									messages: messages.map((message) => message.id),
								},
								reason: 'Anti mention spam trigger',
							})
							.then(() => dmUser(message.author.id, 'Be careful! You have been caught by anti-spam measures.'))
							.catch(() => null),
			);
		}

		await Promise.all(promises);
	}

	public async log(messages: APIMessage | APIMessage[]): Promise<MentionsRunnerResult['data']> {
		if (!Array.isArray(messages)) {
			const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: messages.guild_id } });
			return {
				limit: settings!.mentionLimit!,
			};
		}

		const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: messages[0]!.guild_id } });
		return {
			messages,
			amount: settings!.mentionAmount!,
			time: settings!.mentionTime!,
		};
	}
}
