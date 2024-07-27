import { addFields, truncateEmbed } from '@chatsift/discord-utils';
import { API, type APIEmbed, type APIMessage, type Snowflake } from '@discordjs/core';
import { messageLink, time, TimestampStyles } from '@discordjs/formatters';
import { DiscordSnowflake } from '@sapphire/snowflake';
import { inject, injectable } from 'inversify';
import type { Selectable } from 'kysely';
import type { Logger } from 'pino';
import { INJECTION_TOKENS } from '../container.js';
import { IDatabase } from '../database/IDatabase.js';
import { LogWebhookKind, ModCaseKind, type ModCase } from '../db.js';
import { computeAvatarUrl } from '../util/computeAvatar.js';
import { formatMessageToEmbed } from '../util/userMessageToEmbed.js';
import { userToEmbedAuthor } from '../util/userToEmbedData.js';
import { INotifier, type DMUserOptions, type HistoryEmbedOptions, type LogModCaseOptions } from './INotifier.js';

@injectable()
export class Notifier extends INotifier {
	public constructor(
		private readonly api: API,
		@inject(INJECTION_TOKENS.logger) private readonly logger: Logger,
		private readonly database: IDatabase,
	) {
		super();
	}

	public override async tryDMUser({ userId, bindToGuildId, data }: DMUserOptions): Promise<boolean> {
		if (bindToGuildId) {
			const member = await this.api.guilds.getMember(bindToGuildId, userId).catch((error) => {
				this.logger.warn({ error }, 'Failed to fetch member - assuming they are not in the guild.');
				return null;
			});

			if (!member) {
				return false;
			}
		}

		try {
			const channel = await this.api.users.createDM(userId);
			try {
				await this.api.channels.createMessage(channel.id, data);
				return true;
			} catch (sendError) {
				this.logger.warn({ error: sendError }, 'Failed to send message to DM channel');
			}
		} catch (createDMError) {
			this.logger.warn({ error: createDMError }, 'Failed to create DM channel');
		}

		return false;
	}

	public override generateModCaseEmbed({
		modCase,
		existingMessage,
		mod,
		target,
		references,
	}: LogModCaseOptions): APIEmbed {
		const embed: APIEmbed = existingMessage?.embeds[0] ?? {
			color: this.ACTION_COLORS_MAP[modCase.kind],
			author: userToEmbedAuthor(target, modCase.targetId),
		};

		// We want to re-compute those no matter what for good measure
		embed.title = `Was ${this.ACTION_VERBS_MAP[modCase.kind]}: ${modCase.reason}`;

		// If for some reason the mod field is missing
		if (!embed.footer) {
			embed.footer = {
				text: `Case ${modCase.id} | By ${mod?.username ?? '[Unknown/Deleted user]'} (${modCase.modId})`,
				icon_url: computeAvatarUrl(mod, modCase.modId),
			};
		}

		// Make sure we start fresh
		embed.fields = [];

		if (references?.length) {
			addFields(embed, {
				name: 'References',
				value: references
					.map((ref) =>
						ref.logMessage
							? `[#${ref.id}](${messageLink(ref.logMessage.channelId, ref.logMessage.messageId, modCase.guildId)})`
							: `#${ref.id}`,
					)
					.join(', '),
			});
		}

		return truncateEmbed(embed);
	}

	public override async logModCase(options: LogModCaseOptions): Promise<void> {
		const webhook = await this.database.getLogWebhook(options.modCase.guildId, LogWebhookKind.Mod);
		if (!webhook) {
			this.logger.warn({ options }, 'No mod log webhook found');
			return;
		}

		const data = {
			embeds: [this.generateModCaseEmbed(options)],
			thread_id: webhook.threadId ?? undefined,
		};

		let message: APIMessage;

		if (options.existingMessage) {
			message = await this.api.webhooks.editMessage(
				webhook.webhookId,
				webhook.webhookToken,
				options.existingMessage.id,
				data,
			);
		} else {
			message = await this.api.webhooks.execute(webhook.webhookId, webhook.webhookToken, { ...data, wait: true });
		}

		await this.database.upsertModCaseLogMessage({
			messageId: message.id,
			caseId: options.modCase.id,
			channelId: message.channel_id,
		});
	}

	// TODO: Take in APIGuild?
	public override async tryNotifyTargetModCase(modCase: Selectable<ModCase>): Promise<boolean> {
		try {
			const guild = await this.api.guilds.get(modCase.guildId);
			return await this.tryDMUser({
				userId: modCase.targetId,
				bindToGuildId: modCase.guildId,
				data: {
					content: `You have been ${this.ACTION_VERBS_MAP[modCase.kind]} in ${guild.name}.\n\nReason: ${modCase.reason}`,
				},
			});
		} catch (error) {
			this.logger.error({ error }, 'Failed to fetch guild when notifying target of mod case');
			return false;
		}
	}

	public override generateHistoryEmbed(options: HistoryEmbedOptions): APIEmbed {
		let points = 0;
		const counts = {
			ban: 0,
			kick: 0,
			timeout: 0,
			warn: 0,
		};

		const colors = [0x80f31f, 0xc7c101, 0xf47b7b, 0xf04848] as const;
		const details: string[] = [];

		for (const cs of options.cases) {
			if (cs.kind === ModCaseKind.Ban) {
				counts.ban++;
				points += 3;
			} else if (cs.kind === ModCaseKind.Kick) {
				counts.kick++;
				points += 2;
			} else if (cs.kind === ModCaseKind.Timeout) {
				counts.timeout++;
				points += 0.5;
			} else if (cs.kind === ModCaseKind.Warn) {
				counts.warn++;
				points += 0.25;
			} else {
				continue;
			}

			const action = cs.kind.toUpperCase();
			const caseId = cs.logMessage
				? `[#${cs.id}](${messageLink(cs.logMessage.channelId, cs.logMessage.messageId, cs.guildId)})`
				: `#${cs.id}`;
			const reason = cs.reason ? ` - ${cs.reason}` : '';

			details.push(`• ${time(cs.createdAt, TimestampStyles.LongDate)} \`${action}\` ${caseId}${reason}`);
		}

		const color = colors[points > 0 && points < 1 ? 1 : Math.min(Math.floor(points), 3)];

		const embed: APIEmbed = {
			author: userToEmbedAuthor(options.target, options.target.id),
			color,
		};

		if (points === 0) {
			embed.description = 'No moderation history';
			return embed;
		}

		const footer = Object.entries(counts).reduce<string[]>((arr, [type, count]) => {
			if (count > 0) {
				arr.push(`${count} ${type}${count === 1 ? '' : 's'}`);
			}

			return arr;
		}, []);

		embed.footer = { text: footer.join(' | ') };
		embed.description = details.join('\n');

		return embed;
	}

	public override async logReport(guildId: Snowflake, message: APIMessage): Promise<void> {
		const { reportChannelId } = await this.database.getSettings(guildId);
		if (!reportChannelId) {
			throw new Error('No report channel has been set up in this community; the caller is expected to assert this');
		}

		const embed = formatMessageToEmbed(message);
		embed.color = 0xf04848;
	}
}
