import { clearTimeout, setTimeout } from 'node:timers';
import { URLSearchParams } from 'node:url';
import { DiscordAPIError, REST } from '@discordjs/rest';
import type { LogChannelType, LogChannelWebhook } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import type { APIEmbed, APIWebhook, RESTPostAPIWebhookWithTokenJSONBody } from 'discord-api-types/v10';
import { Routes } from 'discord-api-types/v10';
import { singleton } from 'tsyringe';

type LogBuffer = {
	acks: (() => Promise<void>)[];
	embeds: APIEmbed[];
	timeout: NodeJS.Timeout;
};

@singleton()
export class GuildLogger {
	private readonly buffers = new Map<`${string}-${LogChannelType}`, LogBuffer>();

	public constructor(private readonly prisma: PrismaClient, private readonly rest: REST) {}

	private async getWebhook(data: LogChannelWebhook) {
		try {
			const webhook = (await this.rest.get(Routes.webhook(data.webhookId, data.webhookToken))) as APIWebhook;

			return {
				...webhook,
				threadId: data.threadId,
			};
		} catch (error) {
			if (error instanceof DiscordAPIError && error.status === 404) {
				await this.prisma.logChannelWebhook.delete({
					where: { guildId_logType: { guildId: data.guildId, logType: data.logType } },
				});
			}

			return null;
		}
	}

	private async flushBuffer(guildId: string, logType: LogChannelType, buffer: LogBuffer) {
		clearTimeout(buffer.timeout);
		this.buffers.delete(`${guildId}-${logType}`);

		const { embeds } = buffer;

		const webhookData = await this.prisma.logChannelWebhook.findFirst({ where: { guildId, logType } });
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

		const body: RESTPostAPIWebhookWithTokenJSONBody = {
			embeds,
		};

		await this.rest.post(Routes.webhook(webhook.id, webhook.token), { query, body });
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

	public async log(guildId: string, logType: LogChannelType, embed: APIEmbed, ack: () => Promise<void>) {
		const buffer = this.assertBuffer(guildId, logType);
		buffer.embeds.push(embed);
		buffer.acks.push(ack);

		if (buffer.embeds.length === 10) {
			await this.flushBuffer(guildId, logType, buffer);
		}
	}
}
