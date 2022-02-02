import type { AntispamRunnerResult, Log } from '@automoderator/broker-types';
import type { MessageCache } from '@automoderator/cache';
import { kRedis } from '@automoderator/injection';
import { dmUser } from '@automoderator/util';
import { groupBy } from '@chatsift/utils';
import { PubSubPublisher } from '@cordis/brokers';
import type { Rest } from '@cordis/rest';
import { PrismaClient } from '@prisma/client';
import { Routes, APIMessage, RESTPostAPIChannelMessagesBulkDeleteJSONBody } from 'discord-api-types/v9';
import type { Redis } from 'ioredis';
import { inject, singleton } from 'tsyringe';
import type { IRunner } from './IRunner';

interface AntispamTransform {
	message: APIMessage;
	amount?: number | null;
	time?: number | null;
}

@singleton()
export class AntispamRunner implements IRunner<AntispamTransform, APIMessage[], AntispamRunnerResult> {
	public constructor(
		@inject(kRedis) public readonly redis: Redis,
		public readonly prisma: PrismaClient,
		public readonly messages: MessageCache,
		public readonly discord: Rest,
		public readonly logs: PubSubPublisher<Log>,
	) {}

	public async transform(message: APIMessage): Promise<AntispamTransform> {
		const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: message.guild_id } });

		return {
			message,
			amount: settings?.antispamAmount,
			time: settings?.antispamTime,
		};
	}

	public check({ amount, time }: AntispamTransform): boolean {
		return amount != null && time != null;
	}

	public async run({ message, amount, time }: AntispamTransform): Promise<APIMessage[] | null> {
		const key = `antispam_${message.guild_id!}_${message.author.id}`;

		await this.redis.zadd(key, Date.now(), message.id);
		await this.redis.expire(key, time!);

		const messageIds = await this.redis.zrangebyscore(key, Date.now() - time! * 1000, Date.now());

		if (messageIds.length >= amount!) {
			await this.redis.del(key);

			return (await Promise.all(messageIds.map((id) => this.messages.get(id)))).filter(
				(message): message is APIMessage => Boolean(message),
			);
		}

		return null;
	}

	public async cleanup(messages: APIMessage[]): Promise<void> {
		const grouped = groupBy(messages, (message) => message.channel_id);
		const promises = [];

		for (const [channel, messages] of Object.entries(grouped)) {
			const message = messages[0]!;

			promises.push(
				messages.length === 1
					? this.discord
							.delete(Routes.channelMessage(channel, message.id), { reason: 'Antispam trigger' })
							.then(() => dmUser(message.author.id, 'Be careful! You have been caught by anti-spam measures.'))
							.catch(() => null)
					: this.discord
							.post<never, RESTPostAPIChannelMessagesBulkDeleteJSONBody>(Routes.channelBulkDelete(channel), {
								data: {
									messages: messages.map((message) => message.id),
								},
								reason: 'Antispam trigger',
							})
							.then(() => dmUser(message.author.id, 'Be careful! You have been caught by anti-spam measures.'))
							.catch(() => null),
			);
		}

		await Promise.all(promises);
	}

	public async log(messages: APIMessage[]): Promise<AntispamRunnerResult['data']> {
		const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: messages[0]!.guild_id } });

		return {
			messages,
			amount: settings!.antispamAmount!,
			time: settings!.antispamTime!,
		};
	}
}
