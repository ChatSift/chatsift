import { addFields, truncateEmbed } from '@chatsift/discord-utils';
import { API, type APIEmbed, type APIMessage } from '@discordjs/core';
import { messageLink } from '@discordjs/formatters';
import { inject, injectable } from 'inversify';
import type { Selectable } from 'kysely';
import type { Logger } from 'pino';
import { INJECTION_TOKENS } from '../container.js';
import { IDatabase } from '../database/IDatabase.js';
import { LogWebhookKind, type ModCase } from '../db.js';
import { computeAvatarUrl } from '../util/computeAvatar.js';
import { userToEmbedAuthor } from '../util/userToEmbedData.js';
import { INotifier, type DMUserOptions, type LogModCaseOptions } from './INotifier.js';

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
		embed.footer = {
			text: `Case ${modCase.id} | By ${mod?.username ?? '[Unknown/Deleted user]'} (${modCase.modId})`,
			icon_url: computeAvatarUrl(mod, modCase.modId),
		};

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

		await this.database.createModCaseLogMessage({
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
}
