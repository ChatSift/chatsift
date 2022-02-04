import { Rest } from '@chatsift/api-wrapper';
import { kLogger, kRedis } from '@automoderator/injection';
import { createHash } from 'crypto';
import fetch from 'node-fetch';
import { inject, singleton } from 'tsyringe';
import type { IRunner } from './IRunner';
import { Routes, APIMessage } from 'discord-api-types/v9';
import { MaliciousFile, PrismaClient } from '@prisma/client';
import type { FilesRunnerResult, Log } from '@automoderator/broker-types';
import type { Redis } from 'ioredis';
import { MessageCache } from '@automoderator/cache';
import { PubSubPublisher } from '@cordis/brokers';
import { UrlsRunner } from './urls';
import type { Logger } from 'pino';
import { dmUser } from '@automoderator/util';

interface FilesTransform {
	urls: string[];
}

@singleton()
export class FilesRunner implements IRunner<FilesTransform, MaliciousFile[], FilesRunnerResult> {
	public readonly extensions = new Set(['exe', 'wav', 'mp3', 'flac', 'apng', 'gif', 'ogg', 'mp4', 'avi', 'webp']);

	public constructor(
		@inject(kLogger) public readonly logger: Logger,
		@inject(kRedis) public readonly redis: Redis,
		public readonly prisma: PrismaClient,
		public readonly messages: MessageCache,
		public readonly discord: Rest,
		public readonly logs: PubSubPublisher<Log>,
		public readonly urlsRunner: UrlsRunner,
	) {}

	private async cdnUrlToHash(url: string): Promise<string> {
		const buffer = await fetch(url, { timeout: 15e3, follow: 5 }).then((res) => res.buffer());
		const hash = createHash('sha256').update(buffer).digest('hex');

		return hash;
	}

	public transform(message: APIMessage): FilesTransform {
		const { urls: messageUrls } = this.urlsRunner.transform(message);
		const embedUrls = message.embeds.reduce<string[]>((acc, embed) => {
			if (embed.url) {
				acc.push(embed.url);
			}

			return acc;
		}, []);
		const attachmentUrls = message.attachments.map((attachment) => attachment.url);

		return {
			urls: [...new Set(messageUrls.concat(...embedUrls, ...attachmentUrls))],
		};
	}

	public check({ urls }: FilesTransform): boolean {
		return urls.length > 0;
	}

	public async run({ urls }: FilesTransform): Promise<MaliciousFile[] | null> {
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
			return null;
		}

		return this.prisma.maliciousFile.findMany({ where: { fileHash: { in: hashes } } });
	}

	public async cleanup(_: MaliciousFile[], message: APIMessage): Promise<void> {
		await this.discord
			.delete(Routes.channelMessage(message.channel_id, message.id), { reason: 'File filter trigger' })
			.then(() => dmUser(message.author.id, 'Your message was deleted due to containing a malicious file.'))
			.catch(() => null);
	}

	public log(files: MaliciousFile[]): FilesRunnerResult['data'] {
		return files;
	}
}
