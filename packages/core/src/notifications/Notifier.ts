import type { API } from '@discordjs/core';
import { inject, injectable } from 'inversify';
import type { Logger } from 'pino';
import { INJECTION_TOKENS } from '../container.js';
import { INotifier, type DMUserOptions, type LogModCaseOptions } from './INotifier.js';

@injectable()
export class Notifier extends INotifier {
	public constructor(
		private readonly api: API,
		@inject(INJECTION_TOKENS.logger) private readonly logger: Logger,
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

	public override async logModCase({ modCase }: LogModCaseOptions): Promise<void> {
		throw new Error('Method not implemented.');
	}
}
