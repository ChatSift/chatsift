import { PredictionType, NsfwApiData, Log, NsfwRunnerResult, Runners } from '@automoderator/broker-types';
import { MessageCache } from '@automoderator/cache';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import { dmUser } from '@automoderator/util';
import { PubSubPublisher } from '@cordis/brokers';
import { Rest } from '@cordis/rest';
import { GuildSettings, PrismaClient } from '@prisma/client';
import {
	Routes,
	APIMessage,
	ChannelType,
	APITextChannel,
	GatewayMessageCreateDispatchData,
} from 'discord-api-types/v9';
import fetch from 'node-fetch';
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';
import type { IRunner } from './IRunner';
import { UrlsRunner } from './urls';

interface NsfwTransform {
	urls: string[];
	settings: GuildSettings | null;
	nsfw: boolean;
}

@singleton()
export class NsfwRunner implements IRunner<NsfwTransform, NsfwRunnerResult['data'], NsfwRunnerResult> {
	public readonly ignore = null;

	public readonly API_URL = 'https://gateway.cycloptux.com/api/v1/services/nsfwjs/predict';

	public constructor(
		@inject(kLogger) public readonly logger: Logger,
		@inject(kConfig) public readonly config: Config,
		public readonly prisma: PrismaClient,
		public readonly messages: MessageCache,
		public readonly discord: Rest,
		public readonly logs: PubSubPublisher<Log>,
		public readonly urlsRunner: UrlsRunner,
	) {}

	private async handleUrl(url: string, settings: Partial<GuildSettings>): Promise<NsfwRunnerResult['data']> {
		const res = await fetch(this.API_URL, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'User-Agent': 'AutoModerator (https://automoderator.app) via node-fetch',
				Authorization: this.config.nsfwPredictApiKey,
			},
			body: JSON.stringify({ url }),
		});

		if (!res.ok) {
			this.logger.warn(
				{
					data: await res
						.json()
						.catch(() => res.text())
						.catch(() => null),
					status: res.status,
					url,
				},
				'Failed requst to NSFW API',
			);
			return null;
		}

		const crossed: Exclude<PredictionType, 'neutral' | 'drawing'>[] = [];

		try {
			const data = (await res.json()) as NsfwApiData;
			const predictions = data.predictions.reduce<Record<PredictionType, number>>((acc, prediction) => {
				const procent = Math.round(prediction.probability * 100);
				acc[prediction.className.toLowerCase() as PredictionType] = procent;

				switch (prediction.className) {
					case 'Hentai': {
						if (settings.hentaiThreshold && procent > settings.hentaiThreshold) {
							crossed.push('hentai');
						}

						break;
					}

					case 'Porn': {
						if (settings.pornThreshold && procent > settings.pornThreshold) {
							crossed.push('porn');
						}

						break;
					}

					case 'Sexy': {
						if (settings.sexyThreshold && procent > settings.sexyThreshold) {
							crossed.push('sexy');
						}

						break;
					}

					default: {
						break;
					}
				}

				return acc;
				// eslint-disable-next-line @typescript-eslint/prefer-reduce-type-parameter
			}, {} as Record<PredictionType, number>);

			return {
				...data,
				predictions,
				crossed,
				thresholds: {
					hentai: settings.hentaiThreshold,
					porn: settings.pornThreshold,
					sexy: settings.sexyThreshold,
				},
			};
		} catch (error) {
			this.logger.warn({ error }, 'something went wrong handling the data from the NSFW detection API');
			return null;
		}
	}

	public async transform(message: GatewayMessageCreateDispatchData): Promise<NsfwTransform> {
		const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: message.guild_id } });
		let channel = await this.discord.get<APITextChannel>(Routes.channel(message.channel_id));

		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		if (channel.type !== ChannelType.GuildText) {
			channel = await this.discord.get<APITextChannel>(Routes.channel(channel.parent_id!));
		}

		const { urls: messageUrls } = await this.urlsRunner.transform(message);
		const embedUrls = message.embeds.reduce<string[]>((acc, embed) => {
			if (embed.url) {
				acc.push(embed.url);
			}

			return acc;
		}, []);
		const attachmentUrls = message.attachments.map((attachment) => attachment.url);
		const urls = [...new Set(messageUrls.concat(...embedUrls, ...attachmentUrls))];

		return {
			urls,
			settings,
			nsfw: channel.nsfw ?? false,
		};
	}

	public check({ urls, settings, nsfw }: NsfwTransform): boolean {
		return (
			!nsfw &&
			urls.length > 0 &&
			((settings?.hentaiThreshold ?? 0) > 0 || (settings?.pornThreshold ?? 0) > 0 || (settings?.sexyThreshold ?? 0) > 0)
		);
	}

	public async run({ urls, settings }: NsfwTransform): Promise<NsfwRunnerResult['data'] | null> {
		const results = await Promise.allSettled(urls.map((url) => this.handleUrl(url, settings!)));
		for (const result of results) {
			if (result.status === 'rejected') {
				this.logger.warn({ error: result.reason as unknown }, 'Unexpected thrown error on handleUrl');
				continue;
			}

			const data = result.value;
			if (!data) {
				continue;
			}

			if (data.crossed.length) {
				return data;
			}
		}

		return null;
	}

	public async cleanup(_: NsfwRunnerResult['data'], message: APIMessage): Promise<void> {
		await this.discord
			.delete(Routes.channelMessage(message.channel_id, message.id), { reason: 'NSFW filter trigger' })
			.then(() => dmUser(message.author.id, 'Your message was deleted due to containing a NSFW content.'))
			.catch(() => null);
	}

	public log(trigger: NsfwRunnerResult['data']): NsfwRunnerResult {
		return { runner: Runners.nsfw, data: trigger };
	}
}
