import { Log, Runners, WordsRunnerResult, BanwordFlags } from '@automoderator/broker-types';
import { MessageCache } from '@automoderator/cache';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import { CaseManager, dmUser, ReportHandler } from '@automoderator/util';
import { PubSubPublisher } from '@cordis/brokers';
import { Rest } from '@cordis/rest';
import ms from '@naval-base/ms';
import { PrismaClient, BannedWord, CaseAction } from '@prisma/client';
import { Routes, APIUser, GatewayMessageCreateDispatchData } from 'discord-api-types/v9';
import latinize from 'latinize';
import type { Logger } from 'pino';
import removeAccents from 'remove-accents';
import { inject, singleton } from 'tsyringe';
import type { IRunner } from './IRunner';
import { UrlsRunner } from './urls';

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
		public readonly caseManager: CaseManager,
		@inject(kConfig) public readonly config: Config,
		public readonly reports: ReportHandler,
	) {}

	public async transform(message: GatewayMessageCreateDispatchData): Promise<WordsTransform> {
		const words = await this.prisma.bannedWord.findMany({ where: { guildId: message.guild_id } });
		return { words };
	}

	public check({ words }: WordsTransform): boolean {
		return words.length > 0;
	}

	public run({ words }: WordsTransform, message: GatewayMessageCreateDispatchData): BannedWordWithFlags[] | null {
		const content = latinize(removeAccents(message.content.toLowerCase()));
		const wordsArray = content.split(/ +/g);

		const out: BannedWordWithFlags[] = [];

		for (const entry of words) {
			const flags = new BanwordFlags(entry.flags);
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
			} else {
				continue;
			}
		}

		if (!out.length) {
			return null;
		}

		return out;
	}

	public async cleanup(words: BannedWordWithFlags[], message: GatewayMessageCreateDispatchData): Promise<void> {
		const punishments: Partial<Record<'report' | 'warn' | 'mute' | 'kick' | 'ban', BannedWordWithFlags>> = {};

		for (const entry of words) {
			for (const punishment of entry.flags.getPunishments()) {
				punishments[punishment!] ??= entry;
			}
		}

		const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: message.guild_id } });

		const createCase = async (actionType: CaseAction, entry: BannedWordWithFlags, expiresAt?: Date) => {
			try {
				await this.caseManager.create({
					actionType,
					guildId: message.guild_id!,
					targetId: message.author.id,
					targetTag: `${message.author.username}#${message.author.discriminator}`,
					mod: {
						id: this.config.discordClientId,
						tag: 'AutoModerator',
					},
					reason: `automated punishment for using the word/phrase ${entry.word}`,
					notifyUser: false,
					expiresAt,
					unmuteRoles: settings?.useTimeoutsByDefault ?? true ? null : undefined,
				});
				return true;
			} catch {
				return false;
			}
		};

		if (punishments.report) {
			const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: message.guild_id! } });
			if (settings?.reportsChannel) {
				await this.reports.reportMessage(
					message,
					await this.discord.get<APIUser>(Routes.user(this.config.discordClientId)),
					settings.reportsChannel,
					`Automated report triggered due to the usage of the following word/phrase: ${punishments.report.word}`,
				);
			}

			return;
		}

		const found: string[] = [];
		const applied: string[] = [];

		if (
			punishments.ban &&
			(await createCase(CaseAction.ban, punishments.ban, new Date(Date.now() + Number(punishments.ban.duration))))
		) {
			found.push(punishments.ban.word);
			applied.push(`banned for ${ms(Number(punishments.ban.duration))}`);
		} else {
			if (punishments.warn && (await createCase(CaseAction.warn, punishments.warn))) {
				found.push(punishments.warn.word);
				applied.push('warned');
			}

			if (
				punishments.mute &&
				(await createCase(CaseAction.mute, punishments.mute, new Date(Date.now() + Number(punishments.mute.duration))))
			) {
				found.push(punishments.mute.word);
				applied.push(`muted for ${ms(Number(punishments.mute.duration))}`);
			}

			if (punishments.kick && (await createCase(CaseAction.kick, punishments.kick))) {
				found.push(punishments.kick.word);
				applied.push('kicked');
			}
		}

		try {
			await this.discord.delete(Routes.channelMessage(message.channel_id, message.id), {
				reason: 'Words filter trigger',
			});
			if (!applied.length) {
				await dmUser(message.author.id, `You message was deleted for containing the following word: ${words[0]!.word}`);
				return;
			}

			await dmUser(
				message.author.id,
				`Your message was deleted for containing the following words/phrases: ${found.join(
					', ',
				)}, causing the following punishments: ${applied.join(', ')}`,
			);
		} catch {}
	}

	public log(words: BannedWordWithFlags[]): WordsRunnerResult {
		return {
			runner: Runners.words,
			data: words
				.filter(({ flags }) => !(flags.has('report') && flags.toArray().length === 1))
				.map(({ flags, ...word }) => ({ flags: flags.valueOf(), ...word })),
		};
	}
}
