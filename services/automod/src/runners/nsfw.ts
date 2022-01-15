import type { GuildSettings, PredictionType, NsfwApiData } from '@automoderator/core';
import { Rest } from '@automoderator/http-client';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import fetch from 'node-fetch';
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';

@singleton()
export class NsfwRunner {
	public readonly API_URL = 'https://gateway.cycloptux.com/api/v1/services/nsfwjs/predict';

	public constructor(
		public readonly rest: Rest,
		@inject(kLogger) public readonly logger: Logger,
		@inject(kConfig) public readonly config: Config,
	) {}

	private async handleUrl(url: string, settings: Partial<GuildSettings>) {
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
				},
				'Failed requst to NSFW API',
			);
			return null;
		}

		const crossed: Exclude<PredictionType, 'neutral' | 'drawing'>[] = [];

		try {
			const data: NsfwApiData = await res.json();
			const predictions = data.predictions.reduce((acc, prediction) => {
				const procent = Math.round(prediction.probability * 100);
				acc[prediction.className.toLowerCase() as PredictionType] = procent;

				switch (prediction.className) {
					case 'Hentai': {
						if (settings.hentai_threshold && procent > settings.hentai_threshold) {
							crossed.push('hentai');
						}

						break;
					}

					case 'Porn': {
						if (settings.porn_threshold && procent > settings.porn_threshold) {
							crossed.push('porn');
						}

						break;
					}

					case 'Sexy': {
						if (settings.sexy_threshold && procent > settings.sexy_threshold) {
							crossed.push('sexy');
						}

						break;
					}

					default: {
						break;
					}
				}

				return acc;
			}, {} as Record<PredictionType, number>);

			return {
				...data,
				predictions,
				crossed,
			};
		} catch (error) {
			this.logger.warn({ error }, 'something went wrong handling the data from the NSFW detection API');
			return null;
		}
	}

	public async run(urls: string[], settings: Partial<GuildSettings>) {
		const results = await Promise.allSettled(urls.map((url) => this.handleUrl(url, settings)));
		for (const result of results) {
			if (result.status === 'rejected') {
				this.logger.warn({ error: result.reason }, 'Unexpected thrown error on handleUrl');
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
}
