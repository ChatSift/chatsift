import { MaliciousUrl, PrismaClient } from '@prisma/client';
import { Rest } from '@cordis/rest';
import { kLogger, kRedis } from '@automoderator/injection';
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';
import fetch from 'node-fetch';
import type { IRunner } from './IRunner';
import { GlobalsRunnerResult, Log, Runners } from '@automoderator/broker-types';
import type { Redis } from 'ioredis';
import { MessageCache } from '@automoderator/cache';
import { PubSubPublisher } from '@cordis/brokers';
import { Routes, APIMessage } from 'discord-api-types/v9';
import { UrlsRunner } from './urls';
import { dmUser } from '@automoderator/util';

interface GlobalsTransform {
	urls: string[];
	use: boolean;
}

@singleton()
export class GlobalsRunner
	implements IRunner<GlobalsTransform, (MaliciousUrl | { url: string })[], GlobalsRunnerResult>
{
	public readonly ignore = 'global';

	public readonly fishUrl = 'https://api.hyperphish.com/gimme-domains' as const;
	public readonly fishCache = new Set<string>();
	public lastRefreshedFish: number | null = null;

	public constructor(
		@inject(kLogger) public readonly logger: Logger,
		@inject(kRedis) public readonly redis: Redis,
		public readonly prisma: PrismaClient,
		public readonly messages: MessageCache,
		public readonly discord: Rest,
		public readonly logs: PubSubPublisher<Log>,
		public readonly urlsRunner: UrlsRunner,
	) {
		void this.refreshFish();
	}

	private async refreshFish() {
		if (this.lastRefreshedFish && Date.now() - this.lastRefreshedFish < 6e4) {
			return;
		}

		const res = await fetch(this.fishUrl).catch(() => null);
		const domains = await (res?.json() as Promise<string[]>).catch(() => null);

		if (!domains) {
			this.logger.warn('Something went wrong grabbing fish data');
			return;
		}

		this.lastRefreshedFish = Date.now();
		this.fishCache.clear();

		for (const domain of domains) {
			this.fishCache.add(domain);
		}
	}

	private async isForbiddenByFish(url: string): Promise<boolean> {
		await this.refreshFish();
		return this.fishCache.has(url.split('/')[0]!);
	}

	public async transform(message: APIMessage): Promise<GlobalsTransform> {
		const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: message.guild_id } });

		return {
			urls: this.urlsRunner.transform(message).urls,
			use: settings?.useGlobalFilters ?? false,
		};
	}

	public check({ use, urls }: GlobalsTransform): boolean {
		return use && urls.length > 0;
	}

	public async run({ urls }: GlobalsTransform): Promise<(MaliciousUrl | { url: string })[] | null> {
		const hits = new Map<string, MaliciousUrl | { url: string }>();

		const builtIn = await this.prisma.maliciousUrl.findMany({ where: { url: { in: urls } } });
		for (const hit of builtIn) {
			hits.set(hit.url, hit);
		}

		const isForbiddenByFish = await Promise.all(urls.map((url) => this.isForbiddenByFish(url)));
		for (let i = 0; i < urls.length; i++) {
			if (isForbiddenByFish[i]) {
				hits.set(urls[i]!, { url: urls[i]! });
			}
		}

		if (!hits.size) {
			return null;
		}

		return [...hits.values()];
	}

	public async cleanup(_: (MaliciousUrl | { url: string })[], message: APIMessage): Promise<void> {
		await this.discord
			.delete(Routes.channelMessage(message.channel_id, message.id), { reason: 'Global filter trigger' })
			.then(() => dmUser(message.author.id, 'Your message was deleted due to containing a malicious url.'))
			.catch(() => null);
	}

	public log(urls: (MaliciousUrl | { url: string })[]): GlobalsRunnerResult {
		return { runner: Runners.globals, data: urls };
	}
}
