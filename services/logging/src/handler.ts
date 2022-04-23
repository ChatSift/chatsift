import {
	FilterTriggerLog,
	ForbiddenNameLog,
	GroupedServerLogs,
	Log,
	LogTypes,
	ModActionLog,
	RunnerResult,
	Runners,
	ServerLog,
	ServerLogType,
} from '@automoderator/broker-types';
import {
	PrismaClient,
	Case,
	GuildSettings,
	MaliciousFileCategory,
	MaliciousUrlCategory,
	LogChannelType,
} from '@prisma/client';
import { BanwordFlags } from '@chatsift/api-wrapper/v2';
import { ms } from '@naval-base/ms';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import { truncateEmbed } from '@chatsift/discord-utils';
import { makeCaseEmbed } from '@automoderator/util';
import { createAmqp, PubSubSubscriber } from '@cordis/brokers';
import { HTTPError as CordisHTTPError, Rest } from '@cordis/rest';
import { getCreationData, makeDiscordCdnUrl } from '@cordis/util';
import {
	APIEmbed,
	APIMessage,
	APIUser,
	APIWebhook,
	RESTPatchAPIWebhookWithTokenMessageJSONBody,
	RESTPostAPIWebhookWithTokenJSONBody,
	RESTPostAPIWebhookWithTokenWaitResult,
	RouteBases,
	Routes,
} from 'discord-api-types/v9';
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';

@singleton()
export class Handler {
	public constructor(
		@inject(kConfig) public readonly config: Config,
		@inject(kLogger) public readonly logger: Logger,
		public readonly prisma: PrismaClient,
		public readonly rest: Rest,
	) {}

	private async assertWebhook(
		guild: string,
		type: LogChannelType,
	): Promise<(APIWebhook & { threadId: string | null }) | null> {
		const webhookData = await this.prisma.logChannelWebhook.findFirst({ where: { guildId: guild, logType: type } });
		if (!webhookData) {
			return null;
		}

		try {
			const webhook = await this.rest.get<APIWebhook>(Routes.webhook(webhookData.webhookId, webhookData.webhookToken));
			return {
				...webhook,
				threadId: webhookData.threadId,
			};
		} catch (error) {
			if (error instanceof CordisHTTPError && error.response.status === 404) {
				await this.prisma.logChannelWebhook.delete({ where: { guildId_logType: { guildId: guild, logType: type } } });
			}

			return null;
		}
	}

	private async handleModLog(log: ModActionLog) {
		log.data = Array.isArray(log.data) ? log.data : [log.data];

		if (!log.data.length) {
			return;
		}

		const webhook = await this.assertWebhook(log.data[0]!.guildId, LogChannelType.mod);
		if (!webhook) {
			return;
		}

		const embeds: APIEmbed[] = [];

		for (const entry of log.data) {
			this.logger.metric!({ type: 'mod_action', actionType: entry.actionType, guild: entry.guildId });

			const { logMessageId } = await this.prisma.case.findFirst({ where: { id: entry.id }, rejectOnNotFound: true });

			const [target, mod, message] = await Promise.all([
				this.rest.get<APIUser>(Routes.user(entry.targetId)),
				entry.modId ? this.rest.get<APIUser>(Routes.user(entry.modId)) : Promise.resolve(null),
				logMessageId
					? this.rest.get<APIMessage>(Routes.channelMessage(webhook.channel_id, logMessageId)).catch(() => null)
					: Promise.resolve(null),
			]);

			let pardonedBy: APIUser | undefined;
			if (entry.pardonedBy) {
				pardonedBy = entry.pardonedBy === mod?.id ? mod : await this.rest.get<APIUser>(Routes.user(entry.targetId));
			}

			let refCs: Case | undefined;
			if (entry.refId) {
				refCs = (await this.prisma.case.findFirst({ where: { guildId: entry.guildId, caseId: entry.refId } }))!;
			}

			const embed = makeCaseEmbed({
				logChannelId: webhook.channel_id,
				cs: entry,
				target,
				mod,
				pardonedBy,
				message,
				refCs,
			});

			if (message) {
				return this.rest.patch<unknown, RESTPatchAPIWebhookWithTokenMessageJSONBody>(
					Routes.webhookMessage(webhook.id, webhook.token!, message.id),
					{ data: { embeds: [embed] } },
				);
			}

			embeds.push(embed);
		}

		for (let i = 0; i < Math.ceil(embeds.length / 10); i++) {
			void this.rest
				.post<RESTPostAPIWebhookWithTokenWaitResult, RESTPostAPIWebhookWithTokenJSONBody>(
					`${Routes.webhook(webhook.id, webhook.token)}?wait=true${
						webhook.threadId ? `&thread_id=${webhook.threadId}` : ''
					}`,
					{
						data: {
							embeds: embeds.slice(0 + i * 10, 10 + i * 10),
						},
					},
				)
				.then((newMessage) =>
					this.prisma.case.update({
						data: { logMessageId: newMessage.id },
						where: { id: (log.data as Case[])[i]!.id },
					}),
				);
		}
	}

	private embedFromTrigger(message: APIMessage, trigger: RunnerResult): APIEmbed[] {
		const codeblock = (str: string) => `\`\`\`${str}\`\`\``;

		const embeds: APIEmbed[] = [];
		const push = (embed: APIEmbed) =>
			embeds.push(
				truncateEmbed({
					color: 16426011,
					author: {
						name: `${message.author.username}#${message.author.discriminator} (${message.author.id})`,
						icon_url: message.author.avatar
							? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${message.author.id}/${message.author.avatar}`)
							: `${RouteBases.cdn}/embed/avatars/${parseInt(message.author.discriminator, 10) % 5}.png`,
					},
					...embed,
				}),
			);

		switch (trigger.runner) {
			case Runners.files: {
				const hashes = trigger.data
					.map((file) => `${file.fileHash} (${MaliciousFileCategory[file.category]!})`)
					.join(', ');

				push({
					title: 'Posted malicious files',
					description: `In <#${message.channel_id}>\n${codeblock(hashes)}`,
				});

				break;
			}

			case Runners.urls: {
				break;
			}

			case Runners.globals: {
				const urls = trigger.data
					.map((url) => `${url.url} (${'category' in url ? MaliciousUrlCategory[url.category]! : 'Fish'})`)
					.join(', ');

				push({
					title: 'Posted malicious urls',
					description: `Blocked URLs:\n${urls}`,
				});

				break;
			}

			case Runners.invites: {
				const invites = trigger.data.map((invite) => `https://discord.gg/${invite}`).join(', ');

				push({
					title: 'Posted unallowed invites',
					description: `In <#${message.channel_id}>\n${codeblock(message.content)}`,
					footer: {
						text: `Blocked invites:\n${invites}`,
					},
				});

				break;
			}

			case Runners.words: {
				const { words, urls } = trigger.data.reduce<{ words: string[]; urls: string[] }>(
					(acc, entry) => {
						if (entry.isUrl) {
							acc.urls.push(entry.word);
						} else {
							acc.words.push(entry.word);
						}

						return acc;
					},
					{ words: [], urls: [] },
				);

				if (words.length) {
					push({
						title: 'Posted prohibited content',
						description: `In <#${message.channel_id}>\n${codeblock(message.content)}`,
						footer: {
							text: `Blocked words:\n${words.join(', ')}`,
						},
					});
				}

				if (urls.length) {
					push({
						title: 'Posted prohibited content',
						description: `In <#${message.channel_id}>\n${codeblock(message.content)}`,
						footer: {
							text: `Blocked urls:\n${urls.join(', ')}`,
						},
					});
				}

				break;
			}

			case Runners.antispam: {
				const channels = [...new Set(trigger.data.messages.map((m) => `<#${m.channel_id}>`))].join(', ');

				push({
					title: 'Triggered anti-spam measures',
					description:
						`Tried to send ${trigger.data.amount} messages within ${ms(trigger.data.time, true)}\nIn: ${channels}\n\n` +
						`**Deleted spam**:\`\`\`\n${trigger.data.messages.map((m) => m.content).join('\n')}\`\`\``,
				});

				break;
			}

			case Runners.mentions: {
				const channels =
					'messages' in trigger.data
						? [...new Set(trigger.data.messages.map((m) => `<#${m.channel_id}>`))].join(', ')
						: [`<#${message.channel_id}>`].join(', ');

				const description =
					'messages' in trigger.data
						? `Tried to send ${trigger.data.amount} mentions within ${ms(trigger.data.time, true)}\nIn: ${channels}`
						: `Tried to send ${trigger.data.limit} mentions within a single message`;

				const contents =
					'messages' in trigger.data ? trigger.data.messages.map((m) => m.content).join('\n') : message.content;

				push({
					title: 'Triggered anti mention spam measures',
					description: `${description}\n\n**Deleted spam**: \`\`\`\n${contents}\`\`\``,
				});

				break;
			}

			case Runners.nsfw: {
				const audit =
					'>>> ' +
					`Porn (${trigger.data!.predictions.porn}%)\n` +
					`Sexy (${trigger.data!.predictions.sexy}%)\n` +
					`Hentai (${trigger.data!.predictions.hentai}%)\n` +
					`Drawing (${trigger.data!.predictions.drawing}%)\n` +
					`Neutral (${trigger.data!.predictions.neutral}%)`;

				push({
					title: `Posted an image tagged as ${trigger
						.data!.crossed.map((type) => `\`${type.toUpperCase()}\``)
						.join(', ')}`,
					description: `In <#${message.channel_id}>`,
					image: {
						url: trigger.data!.thumbnail_url,
					},
					fields: [
						{
							name: 'Audit',
							value: audit,
							inline: true,
						},
					],
				});

				break;
			}

			default: {
				this.logger.warn({ trigger }, 'Unknown runner type');
			}
		}

		return embeds;
	}

	private async handleFilterTriggerLog(log: FilterTriggerLog) {
		for (const trigger of log.data.triggers) {
			this.logger.metric!({
				type: 'filter_trigger',
				triggerType: Runners[trigger.runner],
				guild: log.data.message.guild_id,
			});
		}

		const webhook = await this.assertWebhook(log.data.message.guild_id!, LogChannelType.filter);
		if (!webhook) {
			return;
		}

		const embeds = log.data.triggers.flatMap((trigger) => this.embedFromTrigger(log.data.message, trigger));

		if (!embeds.length) {
			return;
		}

		await this.rest.post<unknown, RESTPostAPIWebhookWithTokenJSONBody>(
			`${Routes.webhook(webhook.id, webhook.token)}?wait=true${
				webhook.threadId ? `&thread_id=${webhook.threadId}` : ''
			}`,
			{
				data: {
					embeds,
				},
			},
		);
	}

	private async handleUserUpdateLogs(settings: GuildSettings, log: ServerLog, logs: GroupedServerLogs) {
		if (!logs[ServerLogType.nickUpdate].length && !logs[ServerLogType.usernameUpdate].length) {
			return;
		}

		const webhook = await this.assertWebhook(settings.guildId, LogChannelType.user);
		if (!webhook) {
			return;
		}

		const embeds: APIEmbed[] = [];
		const push = (embed: APIEmbed) =>
			embeds.push({
				author: {
					name: `${log.data.user.username}#${log.data.user.discriminator} (${log.data.user.id})`,
					icon_url: log.data.user.avatar
						? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${log.data.user.id}/${log.data.user.avatar}`)
						: `${RouteBases.cdn}/embed/avatars/${parseInt(log.data.user.discriminator, 10) % 5}.png`,
				},
				...embed,
			});

		for (const entry of logs[ServerLogType.nickUpdate]) {
			push({
				title: 'Changed their nickname',
				fields: [
					{
						name: 'New nickname',
						// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
						value: `>>> ${entry.n || 'none'}`,
					},
					{
						name: 'Previous nickname',
						// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
						value: `>>> ${entry.o || 'none'}`,
					},
				],
			});
		}

		for (const entry of logs[ServerLogType.usernameUpdate]) {
			push({
				title: 'Changed their username',
				fields: [
					{
						name: 'New username',
						value: `>>> ${entry.n}`,
					},
					{
						name: 'Previous username',
						value: `>>> ${entry.o}`,
					},
				],
			});
		}

		await this.rest.post<unknown, RESTPostAPIWebhookWithTokenJSONBody>(
			`${Routes.webhook(webhook.id, webhook.token)}?wait=true${
				webhook.threadId ? `&thread_id=${webhook.threadId}` : ''
			}`,
			{
				data: {
					embeds,
				},
			},
		);
	}

	private async handleMessageDeleteLogs(settings: GuildSettings, log: ServerLog, logs: GroupedServerLogs) {
		const webhook = await this.assertWebhook(settings.guildId, LogChannelType.message);
		if (!webhook) {
			return;
		}

		const [entry] = logs[ServerLogType.messageDelete];
		if (!entry) {
			return;
		}

		const ts = Math.round(getCreationData(entry.message.id).createdTimestamp / 1000);

		await this.rest.post<unknown, RESTPostAPIWebhookWithTokenJSONBody>(
			`${Routes.webhook(webhook.id, webhook.token)}?wait=true${
				webhook.threadId ? `&thread_id=${webhook.threadId}` : ''
			}`,
			{
				data: {
					embeds: [
						{
							author: {
								name: `${log.data.user.username}#${log.data.user.discriminator} (${log.data.user.id})`,
								icon_url: log.data.user.avatar
									? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${log.data.user.id}/${log.data.user.avatar}`)
									: `${RouteBases.cdn}/embed/avatars/${parseInt(log.data.user.discriminator, 10) % 5}.png`,
							},
							description: `Deleted their message posted <t:${ts}:R> in <#${entry.message.channel_id}>`,
							fields: [
								{
									name: 'Content',
									value: entry.message.content.length
										? `>>> ${entry.message.content}`
										: 'No content - this message probably held an attachment',
								},
							],
							footer: entry.mod
								? {
										text: `Deleted by ${entry.mod.username}#${entry.mod.discriminator} (${entry.mod.id})`,
										icon_url: entry.mod.avatar
											? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${entry.mod.id}/${entry.mod.avatar}`)
											: `${RouteBases.cdn}/embed/avatars/${parseInt(entry.mod.discriminator, 10) % 5}.png`,
								  }
								: undefined,
						},
					],
				},
			},
		);
	}

	private async handleMessageEditLogs(settings: GuildSettings, log: ServerLog, logs: GroupedServerLogs) {
		const webhook = await this.assertWebhook(settings.guildId, LogChannelType.message);
		if (!webhook) {
			return;
		}

		const [entry] = logs[ServerLogType.messageEdit];
		if (!entry) {
			return;
		}

		const url = `https://discord.com/channels/${entry.message.guild_id!}/${entry.message.channel_id}/${
			entry.message.id
		}`;

		const ts = Math.round(getCreationData(entry.message.id).createdTimestamp / 1000);

		await this.rest.post<unknown, RESTPostAPIWebhookWithTokenJSONBody>(
			`${Routes.webhook(webhook.id, webhook.token)}?wait=true${
				webhook.threadId ? `&thread_id=${webhook.threadId}` : ''
			}`,
			{
				data: {
					embeds: [
						{
							author: {
								name: `${log.data.user.username}#${log.data.user.discriminator} (${log.data.user.id})`,
								icon_url: log.data.user.avatar
									? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${log.data.user.id}/${log.data.user.avatar}`)
									: `${RouteBases.cdn}/embed/avatars/${parseInt(log.data.user.discriminator, 10) % 5}.png`,
							},
							description: `Updated their [message](${url}) posted <t:${ts}:R> in <#${entry.message.channel_id}>`,
							fields: [
								{
									name: 'New content',
									value: `>>> ${entry.n}`,
								},
								{
									name: 'Previous content',
									value: `>>> ${entry.o}`,
								},
							],
						},
					],
				},
			},
		);
	}

	private async handleFilterUpdateLogs(settings: GuildSettings, log: ServerLog, logs: GroupedServerLogs) {
		const webhook = await this.assertWebhook(settings.guildId, LogChannelType.message);
		if (!webhook) {
			return;
		}

		const [entry] = logs[ServerLogType.filterUpdate];
		if (!entry) {
			return;
		}

		const added = entry.added.map((word) => ({ ...word, added: true }));
		const removed = entry.removed.map((word) => ({ ...word, added: false }));

		const list = [...added, ...removed]
			.sort((a, b) => a.word.localeCompare(b.word))
			.map((word) => {
				const flagsArray = new BanwordFlags(word.flags).toArray();

				const flags = flagsArray.length ? `; flags: ${flagsArray.join(', ')}` : '';
				const duration = word.duration ? `; mute duration: ${word.duration}` : '';

				return `${word.added ? '+' : '-'} "${word.word}"${flags}${duration}`;
			})
			.join('\n');

		await this.rest.post<unknown, RESTPostAPIWebhookWithTokenJSONBody>(
			`${Routes.webhook(webhook.id, webhook.token)}?wait=true${
				webhook.threadId ? `&thread_id=${webhook.threadId}` : ''
			}`,
			{
				data: {
					embeds: [
						{
							author: {
								name: `${log.data.user.username}#${log.data.user.discriminator} (${log.data.user.id})`,
								icon_url: log.data.user.avatar
									? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${log.data.user.id}/${log.data.user.avatar}`)
									: `${RouteBases.cdn}/embed/avatars/${parseInt(log.data.user.discriminator, 10) % 5}.png`,
							},
							title: 'Updated the banword list',
							description: `\`\`\`diff\n${list}\`\`\``,
						},
					],
				},
			},
		);
	}

	private async handleServerLog(log: ServerLog) {
		const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: log.data.guild } });

		if (!settings) {
			return;
		}

		const logs = log.data.logs.reduce<GroupedServerLogs>(
			(acc, current) => {
				// @ts-expect-error - Impossible to tell TS the right array is obtained for the given log type
				acc[current.type].push(current.data);
				return acc;
			},
			{
				[ServerLogType.nickUpdate]: [],
				[ServerLogType.usernameUpdate]: [],
				[ServerLogType.messageEdit]: [],
				[ServerLogType.messageDelete]: [],
				[ServerLogType.filterUpdate]: [],
			},
		);

		void this.handleUserUpdateLogs(settings, log, logs);
		void this.handleMessageDeleteLogs(settings, log, logs);
		void this.handleMessageEditLogs(settings, log, logs);
		void this.handleFilterUpdateLogs(settings, log, logs);
	}

	private async handleForbiddenNameLog(log: ForbiddenNameLog) {
		const webhook = await this.assertWebhook(log.data.guildId, LogChannelType.filter);
		if (!webhook) {
			return;
		}

		await this.rest.post<unknown, RESTPostAPIWebhookWithTokenJSONBody>(
			`${Routes.webhook(webhook.id, webhook.token)}?wait=true${
				webhook.threadId ? `&thread_id=${webhook.threadId}` : ''
			}`,
			{
				data: {
					embeds: [
						{
							author: {
								name: `${log.data.user.username}#${log.data.user.discriminator} (${log.data.user.id})`,
								icon_url: log.data.user.avatar
									? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${log.data.user.id}/${log.data.user.avatar}`)
									: `${RouteBases.cdn}/embed/avatars/${parseInt(log.data.user.discriminator, 10) % 5}.png`,
							},
							title: `Had their ${log.data.nick ? 'nick' : 'user'}name filtered`,
							fields: [
								{
									name: 'Before',
									value: `>>> ${log.data.before}`,
									inline: true,
								},
								{
									name: 'After',
									value: `>>> ${log.data.after}`,
									inline: true,
								},
							],
							footer: {
								text: `Content filtered: ${log.data.words.join(', ')}`,
							},
						},
					],
				},
			},
		);
	}

	private handleLog(log: Log) {
		switch (log.type) {
			case LogTypes.modAction: {
				return this.handleModLog(log);
			}

			case LogTypes.filterTrigger: {
				return this.handleFilterTriggerLog(log);
			}

			case LogTypes.server: {
				return this.handleServerLog(log);
			}

			case LogTypes.forbiddenName: {
				return this.handleForbiddenNameLog(log);
			}

			default: {
				return this.logger.warn({ log }, 'Recieved unrecognized base log type');
			}
		}
	}

	public async init() {
		const { channel } = await createAmqp(this.config.amqpUrl);
		const interactions = new PubSubSubscriber<Log>(channel);

		await interactions.init({
			name: 'guild_logs',
			fanout: false,
			cb: (log) => void this.handleLog(log),
		});

		return interactions;
	}
}
