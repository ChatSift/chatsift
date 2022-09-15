import type { AntispamRunnerResult, Log } from '@automoderator/broker-types';
import { Runners } from '@automoderator/broker-types';
import { MessageCache } from '@automoderator/cache';
import { Config, kConfig, kRedis } from '@automoderator/injection';
import type { CaseData } from '@automoderator/util';
import { CaseManager, dmUser } from '@automoderator/util';
import { groupBy } from '@chatsift/utils';
import { PubSubPublisher } from '@cordis/brokers';
import { REST } from '@discordjs/rest';
import { AutomodPunishmentAction, CaseAction, PrismaClient } from '@prisma/client';
import type {
	APIMessage,
	RESTPostAPIChannelMessagesBulkDeleteJSONBody,
	GatewayMessageCreateDispatchData,
} from 'discord-api-types/v9';
import { Routes } from 'discord-api-types/v9';
// @ts-expect-error needed for injection
// eslint-disable-next-line n/no-extraneous-import
import { Redis } from 'ioredis';
import { inject, singleton } from 'tsyringe';
import type { IRunner } from './IRunner';

type AntispamTransform = {
	amount?: number | null;
	time?: number | null;
};

@singleton()
export class AntispamRunner
	implements IRunner<AntispamTransform, GatewayMessageCreateDispatchData[], AntispamRunnerResult>
{
	public readonly ignore = 'automod';

	public constructor(
		@inject(kRedis) public readonly redis: Redis,
		public readonly prisma: PrismaClient,
		public readonly messages: MessageCache,
		public readonly rest: REST,
		public readonly logs: PubSubPublisher<Log>,
		public readonly caseManager: CaseManager,
		@inject(kConfig) public readonly config: Config,
	) {}

	public async transform(message: GatewayMessageCreateDispatchData): Promise<AntispamTransform> {
		const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: message.guild_id } });

		return {
			amount: settings?.antispamAmount,
			time: settings?.antispamTime,
		};
	}

	public check({ amount, time }: AntispamTransform): boolean {
		return amount != null && time != null;
	}

	public async run(
		{ amount, time }: AntispamTransform,
		message: GatewayMessageCreateDispatchData,
	): Promise<APIMessage[] | null> {
		const key = `antispam_${message.guild_id!}_${message.author.id}`;

		await this.redis.zadd(key, Date.now(), message.id);
		await this.redis.expire(key, time!);

		const messageIds = await this.redis.zrangebyscore(key, Date.now() - time! * 1000, Date.now());

		if (messageIds.length >= amount!) {
			await this.redis.del(key);

			return (await Promise.all(messageIds.map(async (id) => this.messages.get(id)))).filter(
				(message): message is APIMessage => Boolean(message),
			);
		}

		return null;
	}

	public async cleanup(messages: GatewayMessageCreateDispatchData[]): Promise<void> {
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
							.delete(Routes.channelMessage(channel, message.id), { reason: 'Antispam trigger' })
							.then(async () => dmUser(message.author.id, 'Be careful! You have been caught by anti-spam measures.'))
							.catch(() => null)
					: this.rest
							.post(Routes.channelBulkDelete(channel), {
								body,
								reason: 'Antispam trigger',
							})
							.then(async () => dmUser(message.author.id, 'Be careful! You have been caught by anti-spam measures.'))
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

	public async log(messages: GatewayMessageCreateDispatchData[]): Promise<AntispamRunnerResult> {
		const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: messages[0]!.guild_id } });

		return {
			runner: Runners.antispam,
			data: {
				messages,
				amount: settings!.antispamAmount!,
				time: settings!.antispamTime!,
			},
		};
	}
}
