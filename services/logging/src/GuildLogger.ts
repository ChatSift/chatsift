import { clearTimeout, setTimeout } from 'node:timers';
import { URLSearchParams } from 'node:url';
import type { DB, LogChannelType, LogChannelWebhook } from '@automoderator/core';
import { API } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import type { APIEmbed } from 'discord-api-types/v10';
import { inject, injectable } from 'inversify';
import { Kysely } from 'kysely';

interface LogBuffer {
	acks: (() => Promise<void>)[];
	embeds: APIEmbed[];
	timeout: NodeJS.Timeout;
}

interface LogData {
	ack(): Promise<void>;
	embed: APIEmbed;
	guildId: string;
	logType: LogChannelType;
}

@injectable()
export class GuildLogger {
	@inject(API)
	private readonly api!: API;

	@inject(Kysely)
	private readonly database!: Kysely<DB>;

	private readonly buffers: Map<`${string}-${LogChannelType}`, LogBuffer>;

	public constructor() {
		this.buffers = new Map();
	}

	private async getWebhook(data: LogChannelWebhook) {
		try {
			const webhook = await this.api.webhooks.get(data.webhookId, { token: data.webhookToken });

			return {
				...webhook,
				threadId: data.threadId,
			};
		} catch (error) {
			if (error instanceof DiscordAPIError && error.status === 404) {
				await this.database
					.deleteFrom('LogChannelWebhook')
					.where('guildId', '=', data.guildId)
					.where('logType', '=', data.logType)
					.execute();
			}

			return null;
		}
	}

	private async flushBuffer(guildId: string, logType: LogChannelType, buffer: LogBuffer) {
		clearTimeout(buffer.timeout);
		this.buffers.delete(`${guildId}-${logType}`);

		const webhookData = await this.database
			.selectFrom('LogChannelWebhook')
			.selectAll()
			.where('guildId', '=', guildId)
			.where('logType', '=', logType)
			.executeTakeFirst();

		if (!webhookData) {
			return null;
		}

		const webhook = await this.getWebhook(webhookData);
		if (!webhook) {
			return null;
		}

		const query = new URLSearchParams({ wait: 'true' });
		if (webhook.threadId) {
			query.append('thread_id', webhook.threadId);
		}

		await this.api.webhooks.execute(webhook.id, webhook.token!, { wait: true, embeds: buffer.embeds });
		await Promise.all(buffer.acks.map(async (ack) => ack()));
	}

	private assertBuffer(guildId: string, logType: LogChannelType): LogBuffer {
		const key = `${guildId}-${logType}` as const;
		const existing = this.buffers.get(key);
		if (existing) {
			return existing;
		}

		const buffer: LogBuffer = {
			embeds: [],
			acks: [],
			timeout: setTimeout(() => void this.flushBuffer(guildId, logType, buffer), 3_000).unref(),
		};

		this.buffers.set(key, buffer);
		return buffer;
	}

	public async log({ guildId, logType, embed, ack }: LogData) {
		const buffer = this.assertBuffer(guildId, logType);
		buffer.embeds.push(embed);
		buffer.acks.push(ack);

		if (buffer.embeds.length === 10) {
			await this.flushBuffer(guildId, logType, buffer);
		}
	}
}
