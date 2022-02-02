import { Rest } from '@chatsift/api-wrapper';
import { kRedis } from '@automoderator/injection';
import { createHash } from 'crypto';
import fetch from 'node-fetch';
import { inject, singleton } from 'tsyringe';
import type { IRunner } from './IRunner';
import type { APIMessage } from 'discord-api-types/v9';
import { MaliciousFile, PrismaClient } from '@prisma/client';
import type { FilesRunnerResult, Log } from '@automoderator/broker-types';
import type { Redis } from 'ioredis';
import { MessageCache } from '@automoderator/cache';
import { PubSubPublisher } from '@cordis/brokers';

@singleton()
export class FilesRunner implements IRunner<APIMessage, MaliciousFile[], FilesRunnerResult> {
	public readonly extensions = new Set(['exe', 'wav', 'mp3', 'flac', 'apng', 'gif', 'ogg', 'mp4', 'avi', 'webp']);

	public constructor(
		@inject(kRedis) public readonly redis: Redis,
		public readonly prisma: PrismaClient,
		public readonly messages: MessageCache,
		public readonly discord: Rest,
		public readonly logs: PubSubPublisher<Log>,
	) {}

	// public constructor(public readonly rest: Rest, @inject(kLogger) public readonly logger: Logger) {}

	private async cdnUrlToHash(url: string): Promise<string> {
		const buffer = await fetch(url, { timeout: 15e3, follow: 5 }).then((res) => res.buffer());
		const hash = createHash('sha256').update(buffer).digest('hex');

		return hash;
	}

	public async check(message: APIMessage): Promise<boolean> {
		const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: message.guild_id } });
	}

	public async run(urls: string[]): Promise<ApiPostFiltersFilesResult> {
		const hashes: string[] = [];
		const promises: Promise<string>[] = urls.map((url) => this.cdnUrlToHash(url));

		for (const promise of await Promise.allSettled(promises)) {
			if (promise.status === 'rejected') {
				this.logger.error({ e: promise.reason as unknown }, 'Failed to fetch the contents of a file');
				continue;
			}

			const hash = createHash('sha256').update(promise.value).digest('hex');

			hashes.push(hash);
		}

		if (!hashes.length) {
			return [];
		}

		return this.rest.post<ApiPostFiltersFilesResult, ApiPostFiltersFilesBody>('/filters/files', { hashes });
	}
}
