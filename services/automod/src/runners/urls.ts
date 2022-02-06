import { PrismaClient } from '@prisma/client';
import { Rest } from '@cordis/rest';
import { Routes, APIMessage } from 'discord-api-types/v9';
import { readFileSync } from 'fs';
import { join as joinPath } from 'path';
import { inject, singleton } from 'tsyringe';
import { MessageCache } from '@automoderator/cache';
import { PubSubPublisher } from '@cordis/brokers';
import { Log, Runners, UrlsRunnerResult } from '@automoderator/broker-types';
import { kLogger } from '@automoderator/injection';
import type { Logger } from 'pino';
import type { IRunner } from './IRunner';
import { dmUser } from '@automoderator/util';

interface UrlsTransform {
	urls: string[];
}

@singleton()
export class UrlsRunner implements IRunner<UrlsTransform, UrlsTransform, UrlsRunnerResult> {
	public readonly ignore = 'urls';

	public readonly urlRegex = /([^\.\s\/]+\.)+(?<tld>[^\.\s\/]+)(?<url>\/[^\s]*)?/gm;
	public readonly tlds: Set<string>;

	public constructor(
		@inject(kLogger) public readonly logger: Logger,
		public readonly prisma: PrismaClient,
		public readonly messages: MessageCache,
		public readonly discord: Rest,
		public readonly logs: PubSubPublisher<Log>,
	) {
		const contents = readFileSync(joinPath(__dirname, '..', '..', 'tlds.txt'), 'utf8');
		this.tlds = contents.split('\n').reduce((acc, line) => {
			if (!line.startsWith('#') && line.length) {
				acc.add(line.toLowerCase());
			}

			return acc;
		}, new Set<string>());

		logger.trace({ tlds: [...this.tlds] }, 'Successfully computed valid tlds');
	}

	private extractRoot(url: string): string {
		const split = url.split('.');
		// This means that we've got at least 1 subdomain - there could be more nested
		if (split.length > 2) {
			// Extract the root domain
			return split.slice(split.length - 2, split.length).join('.');
		}

		return url;
	}

	private cleanDomain(url: string) {
		url = url.replace(/https?:\/\//g, '');

		if (url.includes('/')) {
			// Assume that the URL is formatted correctly. Extract the domain (including the subdomain)
			const fullDomain = url.split('/')[0]!;
			return this.extractRoot(fullDomain);
		}

		return this.extractRoot(url);
	}

	public transform(message: APIMessage): UrlsTransform {
		const urls = [...message.content.matchAll(this.urlRegex)].reduce<Set<string>>((acc, match) => {
			if (this.tlds.has(match.groups!.tld!.toLowerCase())) {
				acc.add(this.cleanDomain(match[0]!));
			}

			return acc;
		}, new Set());

		return {
			urls: [...urls.values()],
		};
	}

	public check({ urls }: UrlsTransform): boolean {
		return urls.length > 0;
	}

	public async run({ urls }: UrlsTransform, message: APIMessage): Promise<UrlsTransform | null> {
		const allowedUrls = await this.prisma.allowedUrl.findMany({ where: { guildId: message.guild_id } });
		const allowed = new Set(allowedUrls.map((url) => this.cleanDomain(url.domain)));

		const forbidden = [...urls.values()].filter((url) => !allowed.has(url));

		if (!forbidden.length) {
			return null;
		}

		return { urls: forbidden };
	}

	public async cleanup(_: UrlsTransform, message: APIMessage): Promise<void> {
		await this.discord
			.delete(Routes.channelMessage(message.channel_id, message.id), { reason: 'URL filter trigger' })
			.then(() => dmUser(message.author.id, 'Your message was deleted due to containing a link.'))
			.catch(() => null);
	}

	public log({ urls }: UrlsTransform): UrlsRunnerResult {
		return { runner: Runners.urls, data: urls };
	}
}
