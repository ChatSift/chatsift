import { MessageCache } from '@automoderator/cache';
import { kLogger } from '@automoderator/injection';
import { HTTPError, Rest } from '@cordis/rest';
import { getCreationData } from '@cordis/util';
import {
	RESTGetAPIChannelMessagesResult,
	RESTPostAPIChannelMessagesBulkDeleteJSONBody,
	APIGuildInteraction,
	APIMessage,
	ChannelType,
	InteractionResponseType,
	Routes,
} from 'discord-api-types/v9';
import type { Logger } from 'pino';
import { inject, injectable } from 'tsyringe';
import type { Command } from '../../command';
import type { PurgeCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';

@injectable()
export default class implements Command {
	public constructor(
		public readonly messagesCache: MessageCache,
		public readonly discordRest: Rest,
		@inject(kLogger) public readonly logger: Logger,
	) {}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof PurgeCommand>) {
		if (!Object.keys(args).length) {
			return send(interaction, { content: 'Please provide at least one argument', flags: 64 });
		}

		await send(interaction, { flags: 64 }, InteractionResponseType.DeferredChannelMessageWithSource);

		let channelId = interaction.channel_id!;
		if (args.channel) {
			if (args.channel.type !== ChannelType.GuildText) {
				throw new ControlFlowError('Please provide a text channel.');
			}

			channelId = args.channel.id;
		}

		if (args.amount == null) {
			args.amount = 100;
		} else {
			if (args.amount < 1) {
				throw new ControlFlowError('Please provide an amount equal or greater than 1');
			}

			if (args.amount > 500) {
				args.amount = 500;
			}
		}

		if ((args.start && !args.end) || (!args.start && args.end)) {
			throw new ControlFlowError('Start must be used with end');
		}

		await send(interaction, { content: 'Collecting messages from the given channel..' });

		const channelMessagesMap =
			(await this.messagesCache.getChannelMessages(channelId)) ?? new Map<string, APIMessage>();

		const messages = await this.discordRest.get<RESTGetAPIChannelMessagesResult>(
			`${Routes.channelMessages(channelId)}?limit=100`,
		);

		for (const message of messages) {
			channelMessagesMap.set(message.id, message);
			void this.messagesCache.add(message);
		}

		await send(interaction, { content: 'Filtering the messages using your criteria..' });

		const toPurge = [...channelMessagesMap.values()]
			.sort((a, b) => {
				const { createdTimestamp: aCreatedTimestamp } = getCreationData(a.id);
				const { createdTimestamp: bCreatedTimestamp } = getCreationData(b.id);
				return bCreatedTimestamp - aCreatedTimestamp;
			})
			.filter((message) => {
				const { createdTimestamp } = getCreationData(message.id);

				// Discord won't purge messages older than 2 weeks regardless
				const TWO_WEEKS = 12096e5;
				const ONE_DAY = 864e5;
				if (Date.now() - createdTimestamp > (args.bots ? ONE_DAY : TWO_WEEKS)) {
					return false;
				}

				if (args.bots && !(message.author.bot || message.webhook_id)) {
					return false;
				}

				if (args.includes && !message.content.includes(args.includes)) {
					return false;
				}

				if (args.user && message.author.id !== args.user.user.id) {
					return false;
				}

				// Can use creation data for start and end to determine if the current message is within range
				if (args.start) {
					const { createdTimestamp: startCreatedTimestamp } = getCreationData(args.start);
					if (createdTimestamp <= startCreatedTimestamp) {
						return false;
					}
				}

				if (args.end) {
					const { createdTimestamp: endCreatedTimestamp } = getCreationData(args.end);
					if (createdTimestamp >= endCreatedTimestamp) {
						return false;
					}
				}

				if (args.media) {
					const checkForExtension = (ext: string): boolean => {
						const expr = new RegExp(`https?:\/\/\\S+\.${ext}`, 'i');
						if (expr.test(message.content)) {
							return true;
						}

						if (message.attachments.find((a) => a.url.endsWith(`.${ext}`))) {
							return true;
						}

						return false;
					};

					const gifExt = ['gif', 'apng'];
					const imageExt = ['png', 'jpg', 'webp'];
					const videoExt = ['mp4', 'webm'];

					let found = false;
					switch (args.media) {
						case 'embeds': {
							found = message.embeds.length > 0;
							break;
						}

						case 'gifs': {
							found = gifExt.some((e) => checkForExtension(e));
							break;
						}

						case 'images': {
							found = imageExt.some((e) => checkForExtension(e));
							break;
						}

						case 'videos': {
							found = videoExt.some((e) => checkForExtension(e));
							break;
						}

						case 'all': {
							found =
								[...gifExt, ...imageExt, ...videoExt].some((e) => checkForExtension(e)) || message.embeds.length > 0;
							break;
						}
					}

					if (!found) {
						return false;
					}
				}

				return true;
			});

		if (!toPurge.length) {
			return send(interaction, {
				content:
					"There were no messages to purge. Keep in mind Discord only supports purging messages that aren't older than 14 days.",
			});
		}

		const loops = Math.ceil(Math.min(args.amount, toPurge.length) / 100);
		const promises: Promise<never>[] = [];
		const amounts: number[] = [];

		for (let i = 0; i < loops; i++) {
			const messages = toPurge.slice(i * 100, args.amount > 100 ? 100 + i * 100 : args.amount).map((m) => m.id);

			for (const message of messages) {
				void this.messagesCache.delete(message);
			}

			amounts.push(messages.length);

			const reason = `Purge by ${interaction.member.user.username}#${interaction.member.user.id} | Cycle ${
				i + 1
			}/${loops}`;

			if (messages.length === 1) {
				promises.push(
					this.discordRest.delete<never>(Routes.channelMessage(channelId, messages[0]!), {
						reason,
					}),
				);

				continue;
			}

			promises.push(
				this.discordRest.post<never, RESTPostAPIChannelMessagesBulkDeleteJSONBody>(
					Routes.channelBulkDelete(channelId),
					{
						data: {
							messages,
						},
						reason,
					},
				),
			);
		}

		let i = 0;
		let purged = 0;

		for (const promise of await Promise.allSettled(promises)) {
			if (promise.status === 'fulfilled') {
				purged += amounts[i++]!;
				continue;
			}

			// Make sure to increment i regardless
			i++;

			if (promise.reason instanceof HTTPError) {
				if (promise.reason.response.status === 403) {
					return send(interaction, { content: 'Ran into a permission error! Could not purge any message.' });
				}

				this.logger.warn(
					{
						guild: interaction.guild_id,
						code: promise.reason.response.status,
					},
					'Someone ran into an unfamiliar error code when purging',
				);
			}
		}

		return send(interaction, { content: `Successfully purged ${purged} messages.` });
	}
}
