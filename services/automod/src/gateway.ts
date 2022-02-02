import { MessageCache } from '@automoderator/cache';
import {
	AntispamRunnerResult,
	// ApiGetGuildsSettingsResult,
	// ApiPostGuildsCasesBody,
	// ApiPostGuildsCasesResult,
	// AutomodPunishment,
	// AutomodTrigger,
	// CaseAction,
	// CaseData,
	DiscordEvents,
	// FilesRunnerResult,
	InvitesRunnerResult,
	UrlsRunnerResult,
	GlobalsRunnerResult,
	Log,
	LogTypes,
	MentionsRunnerResult,
	NotOkRunnerResult,
	OkRunnerResult,
	RunnerResult,
	Runners,
	WordsRunnerResult,
	NsfwRunnerResult,
} from '@automoderator/broker-types';
import type { GuildSettings, FilterIgnore } from '@prisma/client';
import { Rest, FilterIgnores, DiscordPermissions } from '@chatsift/api-wrapper';
import { dmUser, reportMessage, PermissionsChecker, PermissionsCheckerData, UserPerms } from '@automoderator/util';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import { PubSubPublisher, RoutingSubscriber } from '@cordis/brokers';
import { Rest as CordisRest } from '@cordis/rest';
import {
	APIChannel,
	APIUser,
	APIGuild,
	APIMessage,
	APIRole,
	GatewayDispatchEvents,
	ChannelType,
	RESTGetAPIGuildRolesResult,
	RESTPostAPIChannelMessagesBulkDeleteJSONBody,
	Routes,
	Snowflake,
} from 'discord-api-types/v9';
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';
import {
	AntispamRunner,
	FilesRunner,
	UrlsRunner,
	InvitesRunner,
	GlobalsRunner,
	NsfwRunner,
	WordsRunner,
	MentionsRunner,
} from './runners';
import { getCreationData } from '@cordis/util';
import ms from '@naval-base/ms';

interface FilesRunnerData {
	message: APIMessage;
	urls: string[];
}

interface GlobalsRunnerData {
	message: APIMessage;
	urls: string[];
}

interface UrlsRunnerData {
	message: APIMessage;
	urls: string[];
}

interface InviteRunnerData {
	message: APIMessage;
	invites: string[];
}

interface WordsRunnerData {
	message: APIMessage;
	settings: Partial<GuildSettings>;
}

type AntispamRunnerData = WordsRunnerData;

interface NsfwRunnerData {
	message: APIMessage;
	settings: Partial<GuildSettings>;
	urls: string[];
}

@singleton()
export class Gateway {
	public constructor(
		@inject(kConfig) public readonly config: Config,
		@inject(kLogger) public readonly logger: Logger,
		public readonly gateway: RoutingSubscriber<keyof DiscordEvents, DiscordEvents>,
		public readonly logs: PubSubPublisher<Log>,
		public readonly messagesCache: MessageCache,
		public readonly rest: Rest,
		public readonly discord: CordisRest,
		public readonly checker: PermissionsChecker,
		public readonly globals: GlobalsRunner,
		public readonly files: FilesRunner,
		public readonly urls: UrlsRunner,
		public readonly invites: InvitesRunner,
		public readonly words: WordsRunner,
		public readonly antispam: AntispamRunner,
		public readonly mentions: MentionsRunner,
		public readonly nsfw: NsfwRunner,
	) {}

	private async runGlobals({ message, urls }: GlobalsRunnerData): Promise<NotOkRunnerResult | GlobalsRunnerResult> {
		try {
			const hits = await this.globals.run(urls);
			if (hits.length) {
				await this.discord
					.delete(Routes.channelMessage(message.channel_id, message.id), { reason: 'Url filter detection' })
					.then(() =>
						dmUser(
							message.author.id,
							`Your message was deleted due to containing a malicious url: \`${hits[0]!.url}\``,
						),
					)
					.catch(() => null);
			}

			return { ok: true, actioned: hits.length > 0, BaseRunnerResult: hits, runner: Runners.globals };
		} catch (error) {
			this.logger.error({ error }, 'Failed to execute runner globals');
			return { ok: false, runner: Runners.globals };
		}
	}

	private async runFiles({ message, urls }: FilesRunnerData): Promise<NotOkRunnerResult | FilesRunnerResult> {
		try {
			const hits = await this.files.run(urls);
			if (hits.length) {
				await this.discord
					.delete(Routes.channelMessage(message.channel_id, message.id), { reason: 'File filter detection' })
					.then(() => dmUser(message.author.id, 'Your message was deleted due to containing a malicious file.'))
					.catch(() => null);
			}

			return { ok: true, actioned: hits.length > 0, data: hits, runner: Runners.files };
		} catch (error) {
			this.logger.error({ error }, 'Failed to execute runner files');
			return { ok: false, runner: Runners.files };
		}
	}

	private async runUrls({ message, urls }: UrlsRunnerData): Promise<NotOkRunnerResult | UrlsRunnerResult> {
		try {
			const hits = await this.urls.run(urls, message.guild_id!);
			if (hits.length) {
				await this.discord
					.delete(Routes.channelMessage(message.channel_id, message.id), { reason: 'Invite filter detection' })
					.then(() => dmUser(message.author.id, 'Your message was deleted due to containing a link.'))
					.catch(() => null);
			}

			return { ok: true, actioned: hits.length > 0, BaseRunnerResult: hits, runner: Runners.urls };
		} catch (error) {
			this.logger.error({ error }, 'Failed to execute runner urls');
			return { ok: false, runner: Runners.urls };
		}
	}

	private async runInvites({ message, invites }: InviteRunnerData): Promise<NotOkRunnerResult | InvitesRunnerResult> {
		try {
			const hits = await this.invites.run(invites, message.guild_id!);
			if (hits.length) {
				await this.discord
					.delete(Routes.channelMessage(message.channel_id, message.id), { reason: 'Invite filter detection' })
					.then(() => dmUser(message.author.id, 'Your message was deleted due to containing an invite.'))
					.catch(() => null);
			}

			return { ok: true, actioned: hits.length > 0, BaseRunnerResult: hits, runner: Runners.invites };
		} catch (error) {
			this.logger.error({ error }, 'Failed to execute runner invites');
			return { ok: false, runner: Runners.invites };
		}
	}

	private async runWords({ message, settings }: WordsRunnerData): Promise<NotOkRunnerResult | WordsRunnerResult> {
		try {
			const hits = await this.words.run(message);
			if (hits.length) {
				if (!hits.every((hit) => hit.flags.has('report'))) {
					await this.discord
						.delete(Routes.channelMessage(message.channel_id, message.id), { reason: 'Words filter detection' })
						.catch(() => null);
				}

				let warned = false;
				let muted = false;
				let banned = false;
				let reported = false;

				for (const hit of hits) {
					const data: ApiPostGuildsCasesBody = [];
					const unmuteRoles: Snowflake[] = [];

					const reason = `automated punishment triggered for saying ${hit.word}`;

					const caseBase = {
						mod_id: this.config.discordClientId,
						mod_tag: 'AutoModerator#0000',
						reason,
						target_id: message.author.id,
						target_tag: `${message.author.username}#${message.author.discriminator}`,
						created_at: new Date(),
						execute: true,
					};

					if (hit.flags.has('warn') && !warned && !banned) {
						warned = true;
						data.push({ action: CaseAction.warn, ...caseBase });
					}

					if (hit.flags.has('mute') && settings.mute_role && !muted && !banned) {
						muted = true;
						unmuteRoles.concat([...message.member!.roles]);

						let expiresAt: Date | undefined;
						if (hit.duration) {
							expiresAt = new Date(Date.now() + hit.duration * 6e4);
						}

						data.push({ action: CaseAction.mute, expires_at: expiresAt, ...caseBase });
					}

					if (hit.flags.has('ban') && !banned) {
						banned = true;
						data.push({ action: CaseAction.ban, ...caseBase });
					}

					if (hit.flags.has('report') && !reported) {
						reported = true;

						const me = await this.discord.get<APIUser>(Routes.user(this.config.discordClientId));
						const settings = await this.rest.get<ApiGetGuildsSettingsResult>(`/guilds/${message.guild_id!}/settings`);

						await reportMessage(message.guild_id!, me, message, settings);
					}

					if (data.length) {
						let action: string | undefined;
						if (banned) {
							action = 'banned';
						} else if (muted) {
							action = 'muted';
						} else if (warned) {
							action = 'warned';
						}

						await dmUser(
							message.author.id,
							`You have been ${action!}${
								hit.duration ? ` for ${ms(hit.duration * 6e4, true)}` : ''
							} for using the banned word \`${hits[0]!.word}\``,
						).catch(() => null);

						const cases = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(
							`/guilds/${message.guild_id!}/cases`,
							data,
						);

						this.guildLogs.publish({
							data: cases,
							type: LogTypes.modAction,
						});
					} else if (!hit.flags.has('report')) {
						await dmUser(
							message.author.id,
							`Your message was deleted due to containing a banned word: \`${hits[0]!.word}\`.`,
						).catch(() => null);
					}
				}
			}

			return {
				ok: true,
				actioned: hits.length > 0,
				BaseRunnerResult: hits.map((hit) => ({ ...hit, flags: hit.flags.toJSON() as `${bigint}` })),
				runner: Runners.words,
			};
		} catch (error) {
			this.logger.error({ error }, 'Failed to execute runner words');
			return { ok: false, runner: Runners.words };
		}
	}

	private async runAntispam({
		message,
		settings,
	}: AntispamRunnerData): Promise<NotOkRunnerResult | AntispamRunnerResult> {
		try {
			const hits = await this.antispam.run(message, settings.antispam_amount!, settings.antispam_time!);
			const messages = await Promise.all(hits.map((hit) => this.messagesCache.get(hit)));

			if (messages.length) {
				const groupedMessages = messages.reduce<Record<string, string[]>>((acc, m) => {
					if (m) {
						(acc[m.channel_id] ??= []).push(m.id);
					}

					return acc;
				}, {});

				for (const [channel, messages] of Object.entries(groupedMessages)) {
					if (messages.length === 1) {
						await this.discord
							.delete(Routes.channelMessage(channel, messages[0]!), { reason: 'Antispam trigger' })
							.then(() => dmUser(message.author.id, 'Be careful! You have been caught by anti-spam measures.'))
							.catch(() => null);
					} else {
						await this.discord
							.post<never, RESTPostAPIChannelMessagesBulkDeleteJSONBody>(Routes.channelBulkDelete(channel), {
								data: {
									messages,
								},
								reason: 'Antispam trigger',
							})
							.then(() => dmUser(message.author.id, 'Be careful! You have been caught by anti-spam measures.'))
							.catch(() => null);
					}
				}
			}

			return {
				ok: true,
				actioned: hits.length > 0,
				BaseRunnerResult: {
					messages: messages.filter((m): m is APIMessage => Boolean(m)),
					amount: hits.length,
					time:
						hits.length > 0
							? getCreationData(hits[hits.length - 1]!).createdTimestamp - getCreationData(hits[0]!).createdTimestamp
							: 0,
				},
				runner: Runners.antispam,
			};
		} catch (error) {
			this.logger.error({ error }, 'Failed to execute runner antispam');
			return { ok: false, runner: Runners.antispam };
		}
	}

	private async runMentions({
		message,
		settings,
	}: AntispamRunnerData): Promise<NotOkRunnerResult | MentionsRunnerResult> {
		try {
			const hits = await this.mentions.run(
				message,
				settings.mention_amount,
				settings.mention_time,
				settings.mention_limit,
			);
			const messages = await Promise.all(hits.map((hit) => this.messagesCache.get(hit)));

			if (messages.length) {
				const groupedMessages = messages.reduce<Record<string, string[]>>((acc, m) => {
					if (m) {
						(acc[m.channel_id] ??= []).push(m.id);
					}

					return acc;
				}, {});

				for (const [channel, messages] of Object.entries(groupedMessages)) {
					if (messages.length === 1) {
						await this.discord
							.delete(Routes.channelMessage(channel, messages[0]!), { reason: 'Anti mention spam trigger' })
							.then(() => dmUser(message.author.id, 'Be careful! You have been caught by anti-spam measures.'))
							.catch(() => null);
					} else {
						await this.discord
							.post<never, RESTPostAPIChannelMessagesBulkDeleteJSONBody>(Routes.channelBulkDelete(channel), {
								data: {
									messages,
								},
								reason: 'Anti mention spam trigger',
							})
							.then(() => dmUser(message.author.id, 'Be careful! You have been caught by anti-spam measures.'))
							.catch(() => null);
					}
				}
			}

			return {
				ok: true,
				actioned: hits.length > 0,
				BaseRunnerResult:
					hits.length > 1
						? {
								messages: messages.filter((m): m is APIMessage => Boolean(m)),
								amount: hits.length,
								time:
									getCreationData(hits[hits.length - 1]!).createdTimestamp - getCreationData(hits[0]!).createdTimestamp,
						  }
						: {
								message: messages[0]!,
								amount: this.mentions.mentionsFromMessage(messages[0]!.content).length,
						  },
				runner: Runners.mentions,
			};
		} catch (error) {
			this.logger.error({ error }, 'Failed to execute runner mentions');
			return { ok: false, runner: Runners.mentions };
		}
	}

	public async runNsfw({ message, urls, settings }: NsfwRunnerData): Promise<NotOkRunnerResult | NsfwRunnerResult> {
		try {
			const hit = await this.nsfw.run(urls, settings);
			if (hit) {
				await this.discord
					.delete(Routes.channelMessage(message.channel_id, message.id), { reason: 'NSFW filter detection' })
					.then(() => dmUser(message.author.id, 'Your message has been deleted for containing potentially NSFW media.'))
					.catch(() => null);
			}

			return {
				ok: true,
				actioned: Boolean(hit),
				BaseRunnerResult: hit
					? {
							...hit,
							thresholds: {
								hentai: settings.hentai_threshold,
								porn: settings.porn_threshold,
								sexy: settings.sexy_threshold,
							},
							message,
					  }
					: null,
				runner: Runners.nsfw,
			};
		} catch (error) {
			this.logger.error({ error }, 'Failed to execute runner NSFW');
			return { ok: false, runner: Runners.files };
		}
	}

	private async getChannelParent(guildId: Snowflake, channelId: Snowflake): Promise<Snowflake | null> {
		if (!this.channelParentCache.has(channelId)) {
			const channels = await this.discord.get<APIChannel[]>(Routes.guildChannels(guildId));
			for (const channel of channels) {
				if (channel.type === ChannelType.GuildCategory) {
					continue;
				}

				this.channelParentCache.set(channel.id, channel.parent_id ?? null);
				this.nsfwCache.set(channel.id, channel.nsfw ?? false);
			}

			// Thread channel
			if (!this.channelParentCache.has(channelId)) {
				const thread = await this.discord.get<APIChannel>(Routes.channel(channelId));
				this.threadParentCache.set(thread.id, thread.parent_id!);
				this.channelParentCache.set(thread.id, this.channelParentCache.get(thread.parent_id!)!);
				this.nsfwCache.set(thread.id, this.nsfwCache.get(thread.parent_id!) ?? false);
			}
		}

		return this.channelParentCache.get(channelId) ?? null;
	}

	private async onMessage(message: APIMessage) {
		message.content ??= '';
		if (!message.guild_id || message.author.bot || !message.member || message.webhook_id) {
			return;
		}

		const [
			settings = {
				use_url_filters: false,
				use_global_filters: false,
				use_file_filters: false,
				use_invite_filters: false,
				antispam_amount: null,
				antispam_time: null,
				mention_limit: null,
				mention_amount: null,
				mention_time: null,
				porn_threshold: null,
				sexy_threshold: null,
				hentai_threshold: null,
			},
		] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${message.guild_id}`;

		if (this.config.nodeEnv === 'prod') {
			const { member, author } = message;

			if (this.config.devIds.includes(author.id)) {
				return;
			}

			if (this.ownersCache.has(message.guild_id)) {
				if (author.id === this.ownersCache.get(message.guild_id)!) {
					return;
				}
			} else {
				const guild = await this.discord.get<APIGuild>(Routes.guild(message.guild_id), {
					cache: true,
					cacheTime: 36e5,
				});
				this.ownersCache.set(guild.id, guild.owner_id);

				if (guild.owner_id === author.id) {
					return;
				}
			}

			const bitfield = new DiscordPermissions(0n);
			let guildRoles: APIRole[];

			const addPerm = (role: Snowflake) => {
				if (this.permsCache.has(role)) {
					bitfield.add(BigInt(this.permsCache.get(role)!));
					return true;
				}

				return false;
			};

			for (const role of member.roles) {
				if (!addPerm(role)) {
					guildRoles ??= await this.discord
						.get<RESTGetAPIGuildRolesResult>(Routes.guildRoles(message.guild_id))
						.catch(() => []);
					for (const role of guildRoles) {
						this.permsCache.set(role.id, role.permissions);
					}

					addPerm(role);
				}
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

			if (await this.checker.check(checkerData, UserPerms.mod, 'guild_id' in settings ? settings : null)) {
				return;
			}
		}

		const parentId = await this.getChannelParent(message.guild_id, message.channel_id);
		const channelId = this.threadParentCache.get(message.channel_id) ?? message.channel_id;

		const [ignoreData] = await this.sql<[FilterIgnore?]>`
      SELECT * FROM filter_ignores
      WHERE channel_id = ${channelId}
    `;

		const ignores = new FilterIgnores(BigInt(ignoreData?.value ?? '0'));

		if (parentId) {
			const [parentIgnoreData] = await this.sql<[FilterIgnore?]>`
        SELECT * FROM filter_ignores
        WHERE channel_id = ${parentId}
      `;

			ignores.add(BigInt(parentIgnoreData?.value ?? 0));
		}

		const promises: Promise<RunnerResult>[] = [];

		if (settings.use_global_filters && !ignores.has('global') && message.content.length) {
			const urls = this.urls.precheck(message.content);
			if (urls.length) {
				promises.push(this.runGlobals({ message, urls }));
			}
		}

		if (settings.use_url_filters && !ignores.has('urls')) {
			const urls = this.urls.precheck(message.content);
			if (urls.length) {
				promises.push(this.runUrls({ message, urls }));
			}
		}

		if (settings.use_file_filters && !ignores.has('files')) {
			const urls = this.files.precheck([
				...new Set([
					...this.urls.precheck(message.content).map((url) => (url.startsWith('http') ? url : `https://${url}`)),
					...message.embeds.reduce<string[]>((acc, embed) => {
						if (embed.url) {
							acc.push(embed.url);
						}

						return acc;
					}, []),
					...message.attachments.map((attachment) => attachment.url),
				]),
			]);

			this.logger.debug({ attachments: message.attachments, urls });

			if (urls.length) {
				promises.push(this.runFiles({ message, urls }));
			}
		}

		if (settings.use_invite_filters && !ignores.has('invites') && message.content.length) {
			const invites = this.invites.precheck(message.content);
			if (invites.length) {
				promises.push(this.runInvites({ message, invites }));
			}
		}

		if (!ignores.has('words')) {
			promises.push(this.runWords({ message, settings }));
		}

		if (settings.antispam_amount && settings.antispam_time && !ignores.has('automod') && message.content.length) {
			promises.push(this.runAntispam({ message, settings }));
		}

		if (
			((settings.mention_amount && settings.mention_time) || settings.mention_limit) &&
			this.mentions.precheck(message.content) &&
			!ignores.has('automod') &&
			message.content.length
		) {
			promises.push(this.runMentions({ message, settings }));
		}

		if (
			(settings.porn_threshold || settings.sexy_threshold || settings.hentai_threshold) &&
			!this.nsfwCache.get(channelId)
		) {
			const urls = [
				...new Set([
					...this.urls.precheck(message.content).map((url) => (url.startsWith('http') ? url : `https://${url}`)),
					...message.embeds.reduce<string[]>((acc, embed) => {
						if (embed.url) {
							acc.push(embed.url);
						}

						return acc;
					}, []),
					...message.attachments.map((attachment) => attachment.url),
				]),
			];

			if (urls.length) {
				promises.push(this.runNsfw({ message, settings, urls }));
			}
		}

		const data = (await Promise.allSettled(promises)).reduce<RunnerResult[]>((acc, promise) => {
			if (promise.status === 'fulfilled') {
				if (promise.value.ok && promise.value.actioned) {
					acc.push(promise.value);
				}
			}

			return acc;
		}, []);

		this.logger.trace({ data, guild: message.guild_id }, 'Done running automod');

		if (data.length) {
			await this.sql`
        INSERT INTO filter_triggers (guild_id, user_id, count)
        VALUES (${message.guild_id}, ${message.author.id}, next_filter_trigger(${message.guild_id}, ${message.author.id}))
        ON CONFLICT (guild_id, user_id)
        DO UPDATE SET count = next_filter_trigger(${message.guild_id}, ${message.author.id})
      `;

			if (data.find((result) => result.runner === Runners.antispam || result.runner === Runners.mentions)) {
				const [trigger] = await this.sql<[AutomodTrigger]>`
          INSERT INTO automod_triggers (guild_id, user_id, count)
          VALUES (${message.guild_id}, ${message.author.id}, next_automod_trigger(${message.guild_id}, ${message.author.id}))
          ON CONFLICT (guild_id, user_id)
            DO UPDATE SET count = next_automod_trigger(${message.guild_id}, ${message.author.id})
          RETURNING *
        `;

				const [punishment] = await this.sql<[AutomodPunishment?]>`
          SELECT * FROM automod_punishments
          WHERE guild_id = ${message.guild_id}
            AND triggers = ${trigger.count}
        `;

				if (punishment) {
					const ACTIONS = [CaseAction.warn, CaseAction.mute, CaseAction.kick, CaseAction.ban] as const;

					const caseData: CaseData = {
						mod_id: this.config.discordClientId,
						mod_tag: 'AutoModerator#0000',
						target_id: message.author.id,
						target_tag: `${message.author.username}#${message.author.discriminator}`,
						reason: 'spamming',
						created_at: new Date(),
						execute: true,
						action: ACTIONS[punishment.action_type],
					};

					if (caseData.action === CaseAction.mute) {
						caseData.expires_at = punishment.duration ? new Date(Date.now() + punishment.duration * 6e4) : null;
					} else if (caseData.action === CaseAction.ban) {
						caseData.expires_at = punishment.duration ? new Date(Date.now() + punishment.duration * 6e4) : null;
						caseData.delete_message_days = 1;
					}

					const [cs] = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(
						`/guilds/${message.guild_id}/cases`,
						[caseData],
					);

					this.guildLogs.publish({
						data: cs,
						type: LogTypes.modAction,
					});
				}
			}

			this.guildLogs.publish({
				data: {
					message,
					triggers: data as OkRunnerResult<any, any>[],
				},
				type: LogTypes.filterTrigger,
			});
		}
	}

	public async init(): Promsie<void> {
		this.gateway
			.on(GatewayDispatchEvents.MessageCreate, (message) => void this.onMessage(message))
			.on(GatewayDispatchEvents.MessageUpdate, async (message) => {
				const fullMessage =
					(await this.messagesCache.get(message.id)) ??
					(await this.discord
						.get<APIMessage>(Routes.channelMessage(message.channel_id, message.id))
						.then((message) => {
							void this.messagesCache.add(message);
							return message;
						})
						.catch(() => null));

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
