import { MessageCache, GuildMemberCache, CachedGuildMember } from '@automoderator/cache';
import { DiscordEvents, Log, LogTypes, ServerLogs, ServerLogType } from '@automoderator/broker-types';
import { Rest, DiscordPermissions, BanwordFlags } from '@chatsift/api-wrapper/v2';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import { CaseManager, PermissionsChecker, PermissionsCheckerData, ReportHandler, UserPerms } from '@automoderator/util';
import { createAmqp, PubSubPublisher, RoutingSubscriber } from '@cordis/brokers';
import { Rest as CordisRest } from '@cordis/rest';
import { getCreationData } from '@cordis/util';
import {
	APIChannel,
	APIMessage,
	APIGuildMember,
	APIRole,
	APIUser,
	AuditLogEvent,
	GatewayDispatchEvents,
	GatewayGuildBanModifyDispatchData,
	GatewayGuildMemberAddDispatchData,
	GatewayGuildMemberRemoveDispatchData,
	GatewayGuildMemberUpdateDispatchData,
	RESTGetAPIAuditLogQuery,
	RESTGetAPIAuditLogResult,
	RESTPatchAPIGuildMemberJSONBody,
	Routes,
	Snowflake,
	APIThreadChannel,
	APITextChannel,
} from 'discord-api-types/v9';
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';
import { BannedWord, CaseAction, PrismaClient } from '@prisma/client';
import { isSuccess } from '@chatsift/utils';
import ms from '@naval-base/ms';

@singleton()
export class Gateway {
	public guildLogs!: PubSubPublisher<Log>;

	public constructor(
		@inject(kConfig) public readonly config: Config,
		@inject(kLogger) public readonly logger: Logger,
		public readonly prisma: PrismaClient,
		public readonly checker: PermissionsChecker,
		public readonly guildMembersCache: GuildMemberCache,
		public readonly messageCache: MessageCache,
		public readonly rest: Rest,
		public readonly discord: CordisRest,
		public readonly caseManager: CaseManager,
		public readonly reports: ReportHandler,
	) {}

	private async getChannelIds(
		guildId: Snowflake,
		channelId: Snowflake,
	): Promise<[channelId: Snowflake, parentId: Snowflake | null]> {
		const channelList = await this.discord.get<APIChannel[]>(Routes.guildChannels(guildId));
		let channel = channelList.find((c) => c.id === channelId) as APITextChannel | APIThreadChannel | undefined;

		// Thread channel
		if (!channel) {
			const thread = await this.discord.get<APIThreadChannel>(Routes.channel(channelId));
			channel = channelList.find((c) => c.id === thread.parent_id) as APIThreadChannel;
		}

		return [channel.id, channel.parent_id ?? null];
	}

	private async getPerms(guildId: Snowflake): Promise<DiscordPermissions> {
		const guildMe = await this.discord
			.get<APIGuildMember>(Routes.guildMember(guildId, this.config.discordClientId))
			.catch(() => null);
		const roles = await this.discord
			.get<APIRole[]>(Routes.guildRoles(guildId))
			.then((roles) => new Map(roles.map((role) => [role.id, role])))
			.catch(() => null);

		if (!guildMe || !roles) {
			this.logger.warn('Something went wrong getting the guild member object or the guild roles - returning no perms');
			return new DiscordPermissions(0n);
		}

		const perms = guildMe.roles.reduce<DiscordPermissions>(
			(acc, role) => acc.add(BigInt(roles.get(role)!.permissions)),
			new DiscordPermissions(0n),
		);

		return perms;
	}

	private async hasAuditLog(guildId: Snowflake): Promise<boolean> {
		const perms = await this.getPerms(guildId);
		return perms.has('viewAuditLog');
	}

	private async handleGuildBanAdd(data: GatewayGuildBanModifyDispatchData) {
		if (!(await this.hasAuditLog(data.guild_id))) {
			return null;
		}

		const fetchedLog = await this.discord.get<RESTGetAPIAuditLogResult, RESTGetAPIAuditLogQuery>(
			Routes.guildAuditLog(data.guild_id),
			{
				query: {
					action_type: AuditLogEvent.MemberBanAdd,
					limit: 1,
				},
			},
		);

		const existingCs = await this.prisma.case.findFirst({
			where: {
				guildId: data.guild_id,
				targetId: data.user.id,
				actionType: CaseAction.ban,
			},
			orderBy: {
				createdAt: 'desc',
			},
		});

		if (
			(existingCs && Date.now() - existingCs.createdAt.getTime() >= 3e4) ||
			fetchedLog.audit_log_entries[0]?.user_id === this.config.discordClientId
		) {
			return null;
		}

		await this.caseManager.create({
			actionType: CaseAction.ban,
			guildId: data.guild_id,
			targetId: data.user.id,
			targetTag: `${data.user.username}#${data.user.discriminator}`,
			notifyUser: false,
			applyAction: false,
		});
	}

	private async handleGuildBanRemove(data: GatewayGuildBanModifyDispatchData) {
		if (!(await this.hasAuditLog(data.guild_id))) {
			return null;
		}

		const fetchedLog = await this.discord.get<RESTGetAPIAuditLogResult, RESTGetAPIAuditLogQuery>(
			Routes.guildAuditLog(data.guild_id),
			{
				query: {
					action_type: AuditLogEvent.MemberBanRemove,
					limit: 1,
				},
			},
		);

		const existingCs = await this.prisma.case.findFirst({
			where: {
				guildId: data.guild_id,
				targetId: data.user.id,
				actionType: CaseAction.ban,
			},
			orderBy: {
				createdAt: 'desc',
			},
		});

		if (
			(existingCs && Date.now() - existingCs.createdAt.getTime() >= 3e4) ||
			fetchedLog.audit_log_entries[0]?.user_id === this.config.discordClientId
		) {
			return null;
		}

		await this.caseManager.create({
			actionType: CaseAction.ban,
			guildId: data.guild_id,
			targetId: data.user.id,
			targetTag: `${data.user.username}#${data.user.discriminator}`,
			notifyUser: false,
			applyAction: false,
		});
	}

	private async handleGuildMemberRemove(data: GatewayGuildMemberRemoveDispatchData) {
		if (!(await this.hasAuditLog(data.guild_id))) {
			return null;
		}

		const fetchedLog = await this.discord.get<RESTGetAPIAuditLogResult, RESTGetAPIAuditLogQuery>(
			Routes.guildAuditLog(data.guild_id),
			{
				query: {
					action_type: AuditLogEvent.MemberKick,
					limit: 1,
				},
			},
		);

		const [entry] = fetchedLog.audit_log_entries;
		if (
			!entry ||
			entry.target_id !== data.user.id ||
			Date.now() - getCreationData(entry.id).createdAt.getTime() >= 3e4 ||
			entry.user_id === this.config.discordClientId
		) {
			return null;
		}

		await this.caseManager.create({
			actionType: CaseAction.kick,
			guildId: data.guild_id,
			targetId: data.user.id,
			targetTag: `${data.user.username}#${data.user.discriminator}`,
			notifyUser: false,
			applyAction: false,
		});
	}

	private async handleExistingMute(data: GatewayGuildMemberAddDispatchData) {
		const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: data.guild_id } });

		const existingMuteCase = await this.prisma.case.findFirst({
			where: {
				targetId: data.user!.id,
				actionType: CaseAction.mute,
				guildId: data.guild_id,
				task: { is: {} },
			},
		});

		if (!existingMuteCase || existingMuteCase.useTimeouts || !settings?.muteRole) {
			return null;
		}

		await this.discord
			.patch<unknown, RESTPatchAPIGuildMemberJSONBody>(Routes.guildMember(data.guild_id, data.user!.id), {
				data: { roles: [settings.muteRole] },
				reason: 'User is muted but rejoined the server',
			})
			.catch(() => null);
	}

	private async handleJoinAge(data: GatewayGuildMemberAddDispatchData) {
		const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: data.guild_id } });

		if (settings?.minJoinAge == null || data.user!.bot) {
			return null;
		}

		if (Date.now() - getCreationData(data.user!.id).createdAt.getTime() >= settings.minJoinAge) {
			return null;
		}

		await this.discord
			.delete(Routes.guildMember(data.guild_id, data.user!.id), {
				reason: 'Join age violation',
			})
			.catch(() => null);
	}

	private async handleBlankAvatar(data: GatewayGuildMemberAddDispatchData) {
		const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: data.guild_id } });

		if (!settings?.noBlankAvatar || data.user!.bot) {
			return null;
		}

		if (data.user!.avatar) {
			return null;
		}

		await this.discord
			.delete(Routes.guildMember(data.guild_id, data.user!.id), {
				reason: 'Blank avatar violation',
			})
			.catch(() => null);
	}

	private async handleForbiddenName(
		data: APIGuildMember & { user: APIUser; guild_id: Snowflake },
		name: string,
		nick: boolean,
	) {
		const settings = await this.prisma.guildSettings.findFirst({
			where: { guildId: data.guild_id },
			include: { adminRoles: true, modRoles: true },
		});
		const words = await this.prisma.bannedWord.findMany({ where: { guildId: data.guild_id } });

		if (this.config.nodeEnv === 'prod') {
			const checkerData: PermissionsCheckerData = {
				member: {
					...data,
					permissions: '0',
				},
				guild_id: data.guild_id,
			};

			if (
				await this.checker.check(
					checkerData,
					UserPerms.mod,
					new Set(settings?.modRoles.map((r) => r.roleId) ?? []),
					new Set(settings?.adminRoles.map((r) => r.roleId) ?? []),
				)
			) {
				return;
			}
		}

		const entries = words
			.map((word) => ({ ...word, flags: new BanwordFlags(word.flags) }))
			.filter((word) => word.flags.has('name'));

		if (!entries.length) {
			return;
		}

		const content = name.toLowerCase();
		const array = content.split(/ +/g);

		let updatedName = name;
		let highlightedName = name;

		const hits = entries.reduce<typeof entries>((acc, entry) => {
			if ((entry.flags.has('word') && array.includes(entry.word)) || content.includes(entry.word)) {
				acc.push(entry);
				const replace = (value: string, fn: (str: string) => string) => value.replace(new RegExp(entry.word, 'gi'), fn);

				updatedName = replace(updatedName, () => '').replace(/ +/g, ' ');
				highlightedName = replace(highlightedName, (match) => `**${match}**`);
			}

			return acc;
		}, []);

		if (!hits.length) {
			return;
		}

		updatedName = updatedName.length ? updatedName : 'Filtered';

		await this.discord
			.patch<unknown, RESTPatchAPIGuildMemberJSONBody>(Routes.guildMember(data.guild_id, data.user.id), {
				data: {
					nick: updatedName,
				},
			})
			.catch(() => null);

		if (hits.every((hit) => !hit.flags.has('report'))) {
			this.guildLogs.publish({
				type: LogTypes.forbiddenName,
				data: {
					guildId: data.guild_id,
					before: highlightedName,
					after: updatedName,
					words: hits.map((hit) => hit.word),
					user: data.user,
					nick,
				},
			});
		}

		const punishments: Partial<
			Record<'report' | 'warn' | 'mute' | 'kick' | 'ban', Omit<BannedWord, 'flags'> & { flags: BanwordFlags }>
		> = {};

		for (const entry of entries) {
			for (const punishment of entry.flags.getPunishments()) {
				punishments[punishment!] ??= entry;
			}
		}

		const createCase = (
			actionType: CaseAction,
			entry: Omit<BannedWord, 'flags'> & { flags: BanwordFlags },
			expiresAt?: Date,
		) =>
			isSuccess(
				this.caseManager.create({
					actionType,
					guildId: data.guild_id,
					targetId: data.user.id,
					targetTag: `${data.user.username}#${data.user.discriminator}`,
					mod: {
						id: this.config.discordClientId,
						tag: 'AutoModerator',
					},
					reason: `automated punishment having the word/phrase ${entry.word} in their username/nickname`,
					notifyUser: false,
					expiresAt,
					unmuteRoles: settings?.useTimeoutsByDefault ?? true ? null : undefined,
				}),
			);

		if (punishments.report) {
			const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: data.guild_id } });
			if (settings?.reportsChannel) {
				await this.reports.reportUser(
					data.user,
					await this.discord.get<APIUser>(Routes.user(this.config.discordClientId)),
					settings.reportsChannel,
					`Automated report triggered due to the usage of the following word/phrase: ${punishments.report.word} in their username/nickname`,
				);
			}

			return;
		}

		const found: string[] = [];
		const applied: string[] = [];

		if (
			punishments.ban &&
			(await createCase(CaseAction.ban, punishments.ban, new Date(Date.now() + Number(punishments.ban.duration))))
		) {
			found.push(punishments.ban.word);
			applied.push(`banned for ${ms(Number(punishments.ban.duration))}`);
		} else {
			if (punishments.warn && (await createCase(CaseAction.warn, punishments.warn))) {
				found.push(punishments.warn.word);
				applied.push('warned');
			}

			if (
				punishments.mute &&
				(await createCase(CaseAction.mute, punishments.mute, new Date(Date.now() + Number(punishments.mute.duration))))
			) {
				found.push(punishments.mute.word);
				applied.push(`muted for ${ms(Number(punishments.mute.duration))}`);
			}

			if (punishments.kick && (await createCase(CaseAction.kick, punishments.kick))) {
				found.push(punishments.kick.word);
				applied.push('kicked');
			}
		}
	}

	private handleGuildMemberUpdate(o: CachedGuildMember, n: GatewayGuildMemberUpdateDispatchData) {
		if (n.user.bot) {
			return;
		}

		const logs: ServerLogs[] = [];

		if (o.nick !== n.nick) {
			if (n.nick) {
				void this.handleForbiddenName(n as APIGuildMember & { user: APIUser; guild_id: Snowflake }, n.nick, true);
			}

			logs.push({
				type: ServerLogType.nickUpdate,
				data: {
					o: o.nick ?? null,
					n: n.nick ?? null,
				},
			});
		}

		if (o.user.username !== n.user.username) {
			void this.handleForbiddenName(
				n as APIGuildMember & { user: APIUser; guild_id: Snowflake },
				n.user.username,
				false,
			);

			logs.push({
				type: ServerLogType.usernameUpdate,
				data: {
					o: o.user.username,
					n: n.user.username,
				},
			});
		}

		if (logs.length) {
			this.guildLogs.publish({
				type: LogTypes.server,
				data: {
					guild: n.guild_id,
					user: n.user,
					logs,
				},
			});
		}
	}

	private async handleMessageDelete(message: APIMessage) {
		if (!message.guild_id || message.author.bot || message.webhook_id) {
			return;
		}

		const [channelId, parentId] = await this.getChannelIds(message.guild_id, message.channel_id);
		if (
			await this.prisma.logIgnore.findFirst({
				where: { guildId: message.guild_id, channelId: { in: [channelId, parentId ?? ''] } },
			})
		) {
			return;
		}

		let mod: APIUser | undefined;
		if (await this.hasAuditLog(message.guild_id)) {
			const fetchedLog = await this.discord.get<RESTGetAPIAuditLogResult, RESTGetAPIAuditLogQuery>(
				Routes.guildAuditLog(message.guild_id),
				{
					query: {
						action_type: AuditLogEvent.MessageDelete,
						limit: 1,
					},
				},
			);

			const [entry] = fetchedLog.audit_log_entries;
			if (
				entry?.user_id &&
				entry.target_id === message.id &&
				Date.now() - getCreationData(entry.id).createdAt.getTime() < 3e4
			) {
				mod = await this.discord.get<APIUser>(Routes.user(entry.user_id)).catch(() => undefined);
			}
		}

		this.guildLogs.publish({
			type: LogTypes.server,
			data: {
				guild: message.guild_id,
				user: message.author,
				logs: [
					{
						type: ServerLogType.messageDelete,
						data: {
							message,
							mod,
							hadAttachments: Boolean(message.attachments.length || message.embeds.length),
						},
					},
				],
			},
		});
	}

	private async handleMessageUpdate(o: APIMessage, n: APIMessage) {
		if (!n.guild_id || n.author.bot || n.webhook_id) {
			return;
		}

		const [channelId, parentId] = await this.getChannelIds(n.guild_id, n.channel_id);
		if (
			await this.prisma.logIgnore.findFirst({
				where: { guildId: n.guild_id, channelId: { in: [channelId, parentId ?? ''] } },
			})
		) {
			return;
		}

		if (o.content !== n.content) {
			this.guildLogs.publish({
				type: LogTypes.server,
				data: {
					guild: n.guild_id,
					user: n.author,
					logs: [
						{
							type: ServerLogType.messageEdit,
							data: {
								message: n,
								o: o.content || '`none`',
								n: n.content || '`none`',
							},
						},
					],
				},
			});
		}
	}

	public async init() {
		const { channel } = await createAmqp(this.config.amqpUrl);
		const gateway = new RoutingSubscriber<keyof DiscordEvents, DiscordEvents>(channel);
		const logs = new PubSubPublisher(channel);

		await logs.init({ name: 'guild_logs', fanout: false });

		this.guildLogs = logs;

		gateway
			.on(GatewayDispatchEvents.GuildBanAdd, (data) => void this.handleGuildBanAdd(data))
			.on(GatewayDispatchEvents.GuildBanRemove, (data) => void this.handleGuildBanRemove(data))
			.on(GatewayDispatchEvents.GuildMemberRemove, (data) => void this.handleGuildMemberRemove(data))
			.on(GatewayDispatchEvents.GuildMemberAdd, (data) => {
				void this.handleExistingMute(data);
				void this.handleJoinAge(data);
				void this.handleBlankAvatar(data);
				void this.handleForbiddenName(
					data as APIGuildMember & { user: APIUser; guild_id: Snowflake },
					data.user!.username,
					false,
				);
			})
			.on(GatewayDispatchEvents.GuildMemberUpdate, async (data) => {
				const cachedOld = await this.guildMembersCache.get(data.guild_id, data.user.id);

				if (cachedOld) {
					const n = { ...cachedOld, ...data };

					void this.guildMembersCache
						// @ts-expect-error - Common discord-api-types missmatch
						.add(n)
						.catch((error: unknown) =>
							this.logger.warn({ error, guild: data.guild_id }, 'Failed to update message cache'),
						);

					return this.handleGuildMemberUpdate(cachedOld, n);
				}
			})
			.on(GatewayDispatchEvents.MessageDelete, async (data) => {
				const cachedOld = await this.messageCache.get(data.id);

				if (cachedOld) {
					void this.messageCache.delete(data.id);
					return this.handleMessageDelete(cachedOld);
				}
			})
			.on(GatewayDispatchEvents.MessageUpdate, async (data) => {
				const cachedOld = await this.messageCache.get(data.id);

				if (cachedOld) {
					const n = { ...cachedOld, ...data };
					void this.messageCache.add(n).catch((error) => this.logger.warn(error, 'Failed to update message cache'));
					return this.handleMessageUpdate(cachedOld, n);
				}
			});

		await gateway.init({
			name: 'gateway',
			keys: [
				GatewayDispatchEvents.GuildBanAdd,
				GatewayDispatchEvents.GuildBanRemove,
				GatewayDispatchEvents.GuildMemberRemove,
				GatewayDispatchEvents.GuildMemberAdd,
				GatewayDispatchEvents.GuildMemberUpdate,
				GatewayDispatchEvents.MessageDelete,
				GatewayDispatchEvents.MessageUpdate,
			],
			queue: 'mod_observer',
		});

		return gateway;
	}
}
