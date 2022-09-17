import { Log, MentionsRunnerResult, Runners } from '@automoderator/broker-types';
import { MessageCache } from '@automoderator/cache';
import { Config, kConfig, kRedis } from '@automoderator/injection';
import { CaseData, CaseManager, dmUser } from '@automoderator/util';
import { groupBy } from '@chatsift/utils';
import { PubSubPublisher } from '@cordis/brokers';
import { REST } from '@discordjs/rest';
import { AutomodPunishmentAction, CaseAction, PrismaClient } from '@prisma/client';
import {
	Routes,
	APIMessage,
	Snowflake,
	RESTPostAPIChannelMessagesBulkDeleteJSONBody,
	GatewayMessageCreateDispatchData,
} from 'discord-api-types/v9';
import type { Redis } from 'ioredis';
import { inject, singleton } from 'tsyringe';
import type { IRunner } from './IRunner';

interface MentionsTransform {
	mentions: Snowflake[];
	amount?: number | null;
	time?: number | null;
	limit?: number | null;
}

@singleton()
export class MentionsRunner
	implements
		IRunner<
			MentionsTransform,
			GatewayMessageCreateDispatchData | GatewayMessageCreateDispatchData[],
			MentionsRunnerResult
		>
{
	public readonly ignore = 'automod';

	public readonly mentionsRegex = /<@!?&?(?<id>\d{17,19})>/g;

	public constructor(
		@inject(kRedis) public readonly redis: Redis,
		public readonly prisma: PrismaClient,
		public readonly messages: MessageCache,
		public readonly rest: REST,
		public readonly logs: PubSubPublisher<Log>,
		@inject(kConfig) public readonly config: Config,
		public readonly caseManager: CaseManager,
	) {}

	public async transform(message: GatewayMessageCreateDispatchData): Promise<MentionsTransform> {
		const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: message.guild_id } });

		return {
			mentions: [...message.content.matchAll(this.mentionsRegex)].map((match) => match.groups!.id!),
			amount: settings?.mentionAmount,
			time: settings?.mentionTime,
			limit: settings?.mentionLimit,
		};
	}

	public check({ amount, time, limit, mentions }: MentionsTransform): boolean {
		return ((amount != null && time != null) || limit != null) && mentions.length > 0;
	}

	public async run(
		{ mentions, amount, limit, time }: MentionsTransform,
		message: GatewayMessageCreateDispatchData,
	): Promise<GatewayMessageCreateDispatchData | GatewayMessageCreateDispatchData[] | null> {
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

	public async cleanup(messages: GatewayMessageCreateDispatchData | GatewayMessageCreateDispatchData[]): Promise<void> {
		messages = Array.isArray(messages) ? messages : [messages];

		const grouped = groupBy(messages, (message) => message.channel_id);
		const promises = [];

		for (const [channel, messages] of Object.entries(grouped)) {
			const message = messages[0]!;

			const body: RESTPostAPIChannelMessagesBulkDeleteJSONBody = {
				messages: messages.map((message) => message.id),
			};
			promises.push(
				messages.length === 1
					? this.rest
							.delete(Routes.channelMessage(channel, message.id), { reason: 'Anti mention spam trigger' })
							.then(() => dmUser(message.author.id, 'Be careful! You have been caught by anti-spam measures.'))
							.catch(() => null)
					: this.rest
							.post(Routes.channelBulkDelete(channel), {
								body,
								reason: 'Anti mention spam trigger',
							})
							.then(() => dmUser(message.author.id, 'Be careful! You have been caught by anti-spam measures.'))
							.catch(() => null),
			);
		}

		await Promise.all(promises);

		const baseData = { guildId: messages[0]!.guild_id!, userId: messages[0]!.author.id };
		const { count } = await this.prisma.filterTrigger.upsert({
			create: {
				...baseData,
				count: 1,
			},
			update: {
				count: { increment: 1 },
			},
			where: { guildId_userId: baseData },
		});

		const punishment = await this.prisma.automodPunishment.findFirst({
			where: { guildId: messages[0]!.guild_id!, triggers: count },
		});

		if (punishment) {
			const ACTIONS = {
				[AutomodPunishmentAction.warn]: CaseAction.warn,
				[AutomodPunishmentAction.mute]: CaseAction.mute,
				[AutomodPunishmentAction.kick]: CaseAction.kick,
				[AutomodPunishmentAction.ban]: CaseAction.ban,
			};

			const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: messages[0]!.guild_id! } });

			const caseData: CaseData = {
				mod: {
					id: this.config.discordClientId,
					tag: 'AutoModerator#0000',
				},
				targetId: messages[0]!.author.id,
				targetTag: `${messages[0]!.author.username}#${messages[0]!.author.discriminator}`,
				reason: 'spamming',
				guildId: messages[0]!.guild_id!,
				unmuteRoles: settings?.useTimeoutsByDefault ?? true ? null : undefined,
				actionType: ACTIONS[punishment.actionType],
			};

			if (caseData.actionType === CaseAction.mute) {
				caseData.expiresAt = punishment.duration ? new Date(Date.now() + Number(punishment.duration)) : undefined;
			} else if (caseData.actionType === CaseAction.ban) {
				caseData.expiresAt = punishment.duration ? new Date(Date.now() + Number(punishment.duration)) : undefined;
				caseData.deleteDays = 1;
			}

			await this.caseManager.create(caseData);
		}
	}

	public async log(
		messages: GatewayMessageCreateDispatchData | GatewayMessageCreateDispatchData[],
	): Promise<MentionsRunnerResult> {
		if (!Array.isArray(messages)) {
			const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: messages.guild_id } });
			return {
				runner: Runners.mentions,
				data: {
					limit: settings!.mentionLimit!,
				},
			};
		}

		const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: messages[0]!.guild_id } });
		return {
			runner: Runners.mentions,
			data: {
				messages,
				amount: settings!.mentionAmount!,
				time: settings!.mentionTime!,
			},
		};
	}
}
