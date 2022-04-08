import { Log, Runners, WordsRunnerResult } from '@automoderator/broker-types';
import { MessageCache } from '@automoderator/cache';
import { kLogger } from '@automoderator/injection';
import { BanwordFlags } from '@chatsift/api-wrapper/v2';
import { PubSubPublisher } from '@cordis/brokers';
import { Rest } from '@cordis/rest';
import { PrismaClient, BannedWord } from '@prisma/client';
import { Routes, APIMessage } from 'discord-api-types/v9';
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';
import { UrlsRunner } from './urls';
import type { IRunner } from './IRunner';
import { dmUser } from '@automoderator/util';

type BannedWordWithFlags = Omit<BannedWord, 'flags'> & { flags: BanwordFlags; isUrl: boolean };

interface WordsTransform {
	words: BannedWord[];
}

@singleton()
export class WordsRunner implements IRunner<WordsTransform, BannedWordWithFlags[], WordsRunnerResult> {
	public readonly ignore = 'words';

	public constructor(
		@inject(kLogger) public readonly logger: Logger,
		public readonly prisma: PrismaClient,
		public readonly messages: MessageCache,
		public readonly discord: Rest,
		public readonly logs: PubSubPublisher<Log>,
		public readonly urlsRunner: UrlsRunner,
	) {}

	public async transform(message: APIMessage): Promise<WordsTransform> {
		const words = await this.prisma.bannedWord.findMany({ where: { guildId: message.guild_id } });
		return { words };
	}

	public check({ words }: WordsTransform): boolean {
		return words.length > 0;
	}

	public run({ words }: WordsTransform, message: APIMessage): BannedWordWithFlags[] {
		const content = message.content.toLowerCase();
		const wordsArray = content.split(/ +/g);

		const out: BannedWordWithFlags[] = [];

		for (const entry of words) {
			const flags = new BanwordFlags(BigInt(entry.flags));
			const computed: BannedWordWithFlags = {
				...entry,
				flags,
				isUrl: this.urlsRunner.urlRegex.test(entry.word),
			};

			if (flags.has('name')) {
				continue;
			}

			if (flags.has('word')) {
				if (wordsArray.includes(entry.word)) {
					out.push(computed);
				}
			} else if (content.includes(entry.word)) {
				out.push(computed);
			}
		}

		return out;
	}

	public async cleanup(words: BannedWordWithFlags[], message: APIMessage): Promise<void> {
		await this.discord
			.delete(Routes.channelMessage(message.channel_id, message.id), { reason: 'Words filter trigger' })
			.then(() => dmUser(message.author.id, 'Be careful! You have been caught by anti-spam measures.'))
			.catch(() => null);
		// TODO(DD): Handle cases and user dms after API is done
	}

	public log(words: BannedWordWithFlags[]): WordsRunnerResult {
		return { runner: Runners.words, data: words.map(({ flags, ...word }) => ({ flags: flags.valueOf(), ...word })) };
	}
}
