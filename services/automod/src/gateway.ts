import { MessageCache } from '@automoderator/cache';
import {
	// ApiPostGuildsCasesBody,
	// ApiPostGuildsCasesResult,
	// AutomodPunishment,
	// AutomodTrigger,
	// CaseAction,
	// CaseData,
	DiscordEvents,
	Log,
	LogTypes,
	RunnerResult,
} from '@automoderator/broker-types';
import { PrismaClient } from '@prisma/client';
import { Rest, FilterIgnores, DiscordPermissions } from '@chatsift/api-wrapper/v2';
import { PermissionsChecker, PermissionsCheckerData, UserPerms } from '@automoderator/util';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import { PubSubPublisher, RoutingSubscriber } from '@cordis/brokers';
import { Rest as CordisRest } from '@cordis/rest';
import {
	APIGuild,
	APIMessage,
	APIChannel,
	GatewayDispatchEvents,
	RESTGetAPIGuildRolesResult,
	ChannelType,
	Routes,
	APITextChannel,
} from 'discord-api-types/v9';
import type { Logger } from 'pino';
import { container, inject, singleton } from 'tsyringe';
import * as rawRunners from './runners';
import type { IRunner } from './runners';

@singleton()
export class Gateway {
	public readonly runners: IRunner[] = Object.values(rawRunners).map((runner: any) =>
		// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
		container.resolve(runner),
	);

	public constructor(
		@inject(kConfig) public readonly config: Config,
		@inject(kLogger) public readonly logger: Logger,
		public readonly prisma: PrismaClient,
		public readonly gateway: RoutingSubscriber<keyof DiscordEvents, DiscordEvents>,
		public readonly logs: PubSubPublisher<Log>,
		public readonly messagesCache: MessageCache,
		public readonly rest: Rest,
		public readonly discord: CordisRest,
		public readonly checker: PermissionsChecker,
	) {}

	private async onMessage(message: APIMessage) {
		message.content ??= '';
		if (!message.guild_id || message.author.bot || !message.member || message.webhook_id) {
			return;
		}

		const settings = await this.prisma.guildSettings.findFirst({
			where: { guildId: message.guild_id },
			include: { adminRoles: true, modRoles: true },
		});

		if (this.config.nodeEnv === 'prod') {
			const { member, author } = message;

			if (this.config.devIds.includes(author.id)) {
				return;
			}

			const guild = await this.discord.get<APIGuild>(Routes.guild(message.guild_id));
			if (guild.owner_id === author.id) {
				return;
			}

			const bitfield = new DiscordPermissions(0n);
			const guildRoles = await this.discord
				.get<RESTGetAPIGuildRolesResult>(Routes.guildRoles(message.guild_id))
				.catch(() => []);

			for (const role of guildRoles) {
				bitfield.add(BigInt(role.permissions));
			}

			const permissions = bitfield.toJSON() as `${bigint}`;
			const checkerData: PermissionsCheckerData = {
				member: {
					...member,
					user: author,
					permissions,
				},
				guild_id: message.guild_id,
			};

			if (
				await this.checker.check(
					checkerData,
					UserPerms.mod,
					new Set(settings?.modRoles.map((r) => r.roleId) ?? []),
					new Set(settings?.adminRoles.map((r) => r.roleId) ?? []),
					guild.owner_id,
				)
			) {
				return;
			}
		}

		const rawChannels = await this.discord.get<APIChannel[]>(Routes.guildChannels(message.guild_id));
		const channels = new Map(rawChannels.map((channel) => [channel.id, channel]));

		const channel = (channels.get(message.channel_id) ??
			(await this.discord
				.get<APIChannel>(Routes.channel(message.channel_id))
				.catch(() => null))) as APITextChannel | null;

		if (!channel) {
			this.logger.warn("Couldn't resolve channel");
			return;
		}

		// If channel is a thread `maybeThreadParent` won't be a category
		const maybeThreadParent = channels.get(channel.parent_id!);
		const parent =
			maybeThreadParent?.type === ChannelType.GuildCategory ? maybeThreadParent : channels.get(channel.parent_id!);

		const ignoreData = await this.prisma.filterIgnore.findFirst({ where: { channelId: channel.id } });
		const ignores = new FilterIgnores(ignoreData?.value ?? 0n);

		if (parent) {
			const parentIgnoreData = await this.prisma.filterIgnore.findFirst({ where: { channelId: parent.id } });
			ignores.add(BigInt(parentIgnoreData?.value ?? 0));
		}

		const promises = this.runners
			.filter((runner) => !runner.ignore || !ignores.has(runner.ignore))
			.map(async (runner) => {
				const data = (await runner.transform?.(message)) ?? message;
				const check = (await runner.check?.(data, message)) ?? true;

				if (!check) {
					return null;
				}

				const result = await runner.run(data, message);

				if (result === null) {
					return null;
				}

				await runner.cleanup?.(result, message);
				return runner.log(result, message);
			});

		const logs = (await Promise.allSettled(promises)).reduce<RunnerResult[]>((acc, promise) => {
			if (promise.status === 'fulfilled') {
				if (promise.value) {
					acc.push(promise.value);
				}
			} else {
				this.logger.error(promise.reason, 'Failed to run a runner');
			}

			return acc;
		}, []);

		if (logs.length) {
			const queryData = { guildId: message.guild_id, userId: message.author.id };

			await this.prisma.filterTrigger.upsert({
				create: {
					...queryData,
					count: 1,
				},
				update: {
					count: {
						increment: 1,
					},
				},
				where: {
					guildId_userId: queryData,
				},
			});

			this.logs.publish({
				data: {
					message,
					triggers: logs,
				},
				type: LogTypes.filterTrigger,
			});
		}
	}

	public async init(): Promise<void> {
		this.gateway
			.on(GatewayDispatchEvents.MessageCreate, (message) => void this.onMessage(message))
			.on(GatewayDispatchEvents.MessageUpdate, async (message) => {
				const existing = await this.messagesCache.get(message.id);
				if (existing) {
					return this.onMessage({ ...existing, ...message });
				}

				const fullMessage = await this.discord
					.get<APIMessage>(Routes.channelMessage(message.channel_id, message.id))
					.then((message) => {
						void this.messagesCache.add(message);
						return message;
					})
					.catch(() => null);

				if (fullMessage) {
					return this.onMessage(fullMessage);
				}
			});

		await this.gateway.init({
			name: 'gateway',
			keys: [GatewayDispatchEvents.MessageCreate, GatewayDispatchEvents.MessageUpdate],
			queue: 'automod',
		});
	}
}
