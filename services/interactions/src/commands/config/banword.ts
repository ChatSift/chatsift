import { Log, LogTypes, ServerLogType, BanwordFlags, BanwordFlagsResolvable } from '@automoderator/broker-types';
import { kLogger } from '@automoderator/injection';
import { PubSubPublisher } from '@cordis/brokers';
import { File, Rest } from '@cordis/rest';
import ms from '@naval-base/ms';
import { BannedWord, PrismaClient } from '@prisma/client';
import type { APIGuildInteraction } from 'discord-api-types/v9';
import yaml from 'js-yaml';
import fetch from 'node-fetch';
import type { Logger } from 'pino';
import { inject, injectable } from 'tsyringe';
import type { Command } from '../../command';
import type { BanwordCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';

interface ParsedEntry {
	muteduration?: string;
	flags: ('word' | 'warn' | 'mute' | 'ban' | 'report' | 'kick' | 'name')[];
}

@injectable()
export default class implements Command {
	public constructor(
		public readonly rest: Rest,
		public readonly guildLogs: PubSubPublisher<Log>,
		public readonly prisma: PrismaClient,
		@inject(kLogger) public readonly logger: Logger,
	) {}

	private _entriesToYaml(list: BannedWord[]): string {
		const data = list.reduce<Record<string, ParsedEntry>>((acc, entry) => {
			const value: ParsedEntry = {
				flags: new BanwordFlags(BigInt(entry.flags)).toArray(),
			};

			if (entry.duration !== null) {
				value.muteduration = ms(Number(entry.duration), true);
			}

			acc[entry.word] = value;
			return acc;
		}, {});

		return yaml.dump(data, { sortKeys: true, schema: yaml.JSON_SCHEMA });
	}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof BanwordCommand>) {
		switch (Object.keys(args)[0] as keyof typeof args) {
			case 'add': {
				const flags: BanwordFlagsResolvable = [];

				if (args.add.word) {
					flags.push('word');
				}

				if (args.add.warn) {
					flags.push('warn');
				}

				if (args.add.mute) {
					flags.push('mute');
				}

				if (args.add.ban) {
					flags.push('ban');
				}

				if (args.add.report) {
					if (!args.add.name && flags.some((flag) => flag !== 'word')) {
						throw new ControlFlowError(
							'Report is only valid with no flags or with the word flag (unless this is a name ban)',
						);
					}

					flags.push('report');
				}

				if (args.add.name) {
					flags.push('name');
				}

				if (args.add.kick) {
					flags.push('kick');
				}

				const url = args.add.entry.match(/([^\.\s\/]+\.)+(?<tld>[^\.\s\/]+)(?<url>\/[^\s]*)?/gm)?.[0];

				const bannedWord: BannedWord = {
					guildId: interaction.guild_id,
					word: (url ?? args.add.entry).toLowerCase(),
					flags: new BanwordFlags(flags).valueOf(),
					duration: null,
				};

				if (args.add['mute-duration'] != null) {
					if (!args.add.mute) {
						throw new ControlFlowError('You can only provide a mute duration for triggers that cause a mute');
					}

					const parsed = ms(args.add['mute-duration']);
					if (parsed <= 0) {
						throw new ControlFlowError('Failed to parse mute duration');
					}

					bannedWord.duration = BigInt(parsed);
				}

				await this.prisma.bannedWord.upsert({
					create: bannedWord,
					update: bannedWord,
					where: {
						guildId_word: { guildId: bannedWord.guildId, word: bannedWord.word },
					},
				});

				this.guildLogs.publish({
					type: LogTypes.server,
					data: {
						guild: interaction.guild_id,
						user: interaction.member.user,
						logs: [
							{
								type: ServerLogType.filterUpdate,
								data: {
									added: [bannedWord],
									removed: [],
								},
							},
						],
					},
				});

				return send(interaction, { content: 'Successfully banned the given word/phrase' });
			}

			case 'remove': {
				const url = args.remove.entry.match(/([^\.\s\/]+\.)+(?<tld>[^\.\s\/]+)(?<url>\/[^\s]*)?/gm)?.[0];

				try {
					const deleted = await this.prisma.bannedWord.delete({
						where: { guildId_word: { guildId: interaction.guild_id, word: (url ?? args.remove.entry).toLowerCase() } },
					});

					this.guildLogs.publish({
						type: LogTypes.server,
						data: {
							guild: interaction.guild_id,
							user: interaction.member.user,
							logs: [
								{
									type: ServerLogType.filterUpdate,
									data: {
										added: [],
										removed: [deleted],
									},
								},
							],
						},
					});
				} catch {
					throw new ControlFlowError('There was nothing to remove');
				}

				return send(interaction, { content: 'Successfully removed the given word/phrase from the list' });
			}

			case 'list': {
				const list = await this.prisma.bannedWord.findMany({ where: { guildId: interaction.guild_id } });

				if (!list.length) {
					return send(interaction, { content: 'There is currently nothing on your banned words list' });
				}

				return send(interaction, {
					content: "Here's your list",
					files: [{ name: 'bannedwords.yml', content: Buffer.from(this._entriesToYaml(list)) }],
				});
			}

			case 'bulk': {
				const text = await fetch(args.bulk.list.url).then((res) => res.text());

				let parsed;
				try {
					parsed = yaml.load(text, { schema: yaml.JSON_SCHEMA, json: true }) as Record<string, ParsedEntry> | null;
				} catch (error) {
					this.logger.error({ error });
					throw new ControlFlowError(
						`You have a syntax error in your YML file - are you sure you didn't send something else?\n\`${
							(error as Error).message
						}\``,
					);
				}

				if (!parsed) {
					this.logger.debug({ parsed }, 'Failed yml parse object check');
					throw new ControlFlowError('Something is wrong with your YML file - expected a top level object');
				}

				const words: BannedWord[] = [];
				for (const [word, value] of Object.entries(parsed)) {
					let bitfield: BanwordFlags;
					try {
						bitfield = new BanwordFlags(value.flags);
					} catch (error) {
						throw new ControlFlowError(`You provided an invalid flag for \`${word}\`\n${(error as Error).message}`);
					}

					const entry: BannedWord = {
						guildId: interaction.guild_id,
						word,
						flags: bitfield.valueOf(),
						duration: null,
					};

					if (value.muteduration != null) {
						if (!bitfield.has('mute')) {
							throw new ControlFlowError(`You provided a mute time but no mute flag for word/phrase "${word}"`);
						}

						if (typeof value.muteduration !== 'string') {
							throw new ControlFlowError(`Found non-string for mute duration for word/phrase "${word}"`);
						}

						const parsed = ms(value.muteduration);
						if (parsed <= 0) {
							throw new ControlFlowError(`Failed to parse mute duration for word/phrase "${word}"`);
						}

						entry.duration = BigInt(parsed);
					}

					words.push(entry);
				}

				const files: File[] = [];
				const oldEntries = await this.prisma.bannedWord.findMany({ where: { guildId: interaction.guild_id } });
				if (oldEntries.length) {
					files.push({
						name: 'oldlist.yml',
						content: Buffer.from(this._entriesToYaml(oldEntries)),
					});
				}

				const newEntries = await this.prisma.$transaction(async (prisma) => {
					await prisma.bannedWord.deleteMany({ where: { guildId: interaction.guild_id } });
					await prisma.bannedWord.createMany({ data: words });
					return prisma.bannedWord.findMany({ where: { guildId: interaction.guild_id } });
				});

				const oldMap = new Map(oldEntries.map((entry) => [entry.word, entry]));
				const newMap = new Map(newEntries.map((entry) => [entry.word, entry]));

				const removed: BannedWord[] = [];
				const added: BannedWord[] = [];

				for (const entry of oldMap.values()) {
					if (!newMap.has(entry.word)) {
						removed.push(entry);
					}
				}

				for (const entry of newMap.values()) {
					if (!oldMap.has(entry.word)) {
						added.push(entry);
					}
				}

				this.guildLogs.publish({
					type: LogTypes.server,
					data: {
						guild: interaction.guild_id,
						user: interaction.member.user,
						logs: [
							{
								type: ServerLogType.filterUpdate,
								data: {
									added,
									removed,
								},
							},
						],
					},
				});

				if (!newEntries.length) {
					return send(interaction, {
						content: 'Done! All though there is nothing to display, as your list is now empty',
						files,
					});
				}

				files.push({
					name: 'newlist.yml',
					content: Buffer.from(this._entriesToYaml(newEntries)),
				});

				return send(interaction, { content: 'Successfully updated your list in bulk', files });
			}
		}
	}
}
