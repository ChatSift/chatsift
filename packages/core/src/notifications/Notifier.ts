import { truncateEmbed } from '@chatsift/discord-utils';
import type { API, APIEmbed } from '@discordjs/core';
import { inject, injectable } from 'inversify';
import type { Logger } from 'pino';
import type { IDataManager } from '../application-data/IDataManager.js';
import { INJECTION_TOKENS } from '../container.js';
import { LogWebhookKind, ModCaseKind } from '../db.js';
import { computeAvatarUrl } from '../util/computeAvatar.js';
import { promiseAllObject } from '../util/promiseAllObject.js';
import { userToEmbedAuthor } from '../util/userToEmbedData.js';
import { INotifier, type DMUserOptions, type LogModCaseOptions } from './INotifier.js';

@injectable()
export class Notifier extends INotifier {
	private readonly COLORS_MAP = {
		[ModCaseKind.Warn]: 0xf47b7b,
		[ModCaseKind.Timeout]: 0xf47b7b,
		[ModCaseKind.Untimeout]: 0x5865f2,
		[ModCaseKind.Kick]: 0xf47b7b,
		[ModCaseKind.Ban]: 0xf04848,
		[ModCaseKind.Unban]: 0x5865f2,
	} as const satisfies Record<ModCaseKind, number>;

	private readonly ACTION_VERBS_MAP = {
		[ModCaseKind.Warn]: 'warned',
		[ModCaseKind.Timeout]: 'timed out',
		[ModCaseKind.Untimeout]: 'untimed out',
		[ModCaseKind.Kick]: 'kicked',
		[ModCaseKind.Ban]: 'banned',
		[ModCaseKind.Unban]: 'unbanned',
	} as const satisfies Record<ModCaseKind, string>;

	public constructor(
		private readonly api: API,
		@inject(INJECTION_TOKENS.logger) private readonly logger: Logger,
		private readonly dataManager: IDataManager,
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

	public override async logModCase({ modCase, existingMessage }: LogModCaseOptions): Promise<void> {
		const webhook = await this.dataManager.getLogWebhook(modCase.guildId, LogWebhookKind.Mod);
		if (!webhook) {
			this.logger.warn({ modCase }, 'No mod log webhook found');
			return;
		}

		const { target, mod } = await promiseAllObject({
			target: this.api.users.get(modCase.userId).catch(() => null),
			mod: this.api.users.get(modCase.modId).catch(() => null),
		});

		const embed: APIEmbed = existingMessage?.embeds[0] ?? {
			color: this.COLORS_MAP[modCase.kind],
			author: userToEmbedAuthor(target, modCase.userId),
		};

		// We want to re-compute those no matter what for good measure
		embed.title = `Was ${this.ACTION_VERBS_MAP[modCase.kind]} ${modCase.reason}`;
		embed.footer = {
			text: `Case ${modCase.id} | By ${mod?.username ?? '[Unknown/Deleted user]'} (${modCase.modId})`,
			icon_url: computeAvatarUrl(mod, modCase.modId),
		};

		const data = {
			embeds: [truncateEmbed(embed)],
			thread_id: webhook.threadId ?? undefined,
		};

		if (existingMessage) {
			await this.api.webhooks.editMessage(webhook.webhookId, webhook.webhookToken, existingMessage.id, data);
		} else {
			await this.api.webhooks.execute(webhook.webhookId, webhook.webhookToken, data);
		}
	}
}
