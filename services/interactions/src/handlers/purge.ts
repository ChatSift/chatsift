import type { HandlerModule, ICommandHandler } from '@automoderator/core';
import { parseRelativeTime } from '@chatsift/parse-relative-time';
import {
	API,
	ApplicationCommandOptionType,
	InteractionContextType,
	MessageFlags,
	PermissionFlagsBits,
	type APIApplicationCommandInteraction,
} from '@discordjs/core';
import type { InteractionOptionResolver } from '@sapphire/discord-utilities';
import { DiscordSnowflake } from '@sapphire/snowflake';
import { ActionKind, HandlerStep, type InteractionHandler as CoralInteractionHandler } from 'coral-command';
import { injectable } from 'inversify';

@injectable()
export default class PurgeHandler implements HandlerModule<CoralInteractionHandler> {
	public constructor(private readonly api: API) {}

	public register(handler: ICommandHandler<CoralInteractionHandler>) {
		handler.register({
			interactions: [
				{
					name: 'purge',
					description: 'Purges messages based off of your given arguments',
					options: [
						{
							name: 'amount',
							description: 'The (max) amount of messages to delete',
							type: ApplicationCommandOptionType.Integer,
							min_value: 2,
							max_value: 100,
							required: true,
						},
						{
							name: 'channel',
							description: 'Channel to delete messages from - defaults to the current channel',
							type: ApplicationCommandOptionType.Channel,
						},
						{
							name: 'user',
							description: 'Filters messages by a specific user',
							type: ApplicationCommandOptionType.User,
						},
						{
							name: 'start',
							description:
								'This is the first message id for range based purging - end is required if you use this option',
							type: ApplicationCommandOptionType.String,
						},
						{
							name: 'end',
							description:
								'This is the last message id for range based purging - start is required if you use this option',
							type: ApplicationCommandOptionType.String,
						},
						{
							name: 'bots',
							description: 'Filter in only bot messages',
							type: ApplicationCommandOptionType.Boolean,
						},
						{
							name: 'includes',
							description: 'Filter by a given string',
							type: ApplicationCommandOptionType.String,
						},
						{
							name: 'media',
							description: 'Filter by media type',
							type: ApplicationCommandOptionType.String,
							choices: [
								{ name: 'embeds', value: 'embeds' },
								{ name: 'videos', value: 'videos' },
								{ name: 'gifs', value: 'gifs' },
								{ name: 'images', value: 'images' },
								{ name: 'all', value: 'all' },
							],
						},
					],
					contexts: [InteractionContextType.Guild],
					default_member_permissions: String(PermissionFlagsBits.ManageMessages),
				},
			],
			applicationCommands: [['purge:none:none', this.handle.bind(this)]],
		});
	}

	public async *handle(
		interaction: APIApplicationCommandInteraction,
		options: InteractionOptionResolver,
	): CoralInteractionHandler {
		yield* HandlerStep.from({
			action: ActionKind.EnsureDeferReply,
			options: {
				flags: MessageFlags.Ephemeral,
			},
		});

		const amount = options.getInteger('amount', true);
		const channel = options.getChannel('channel') ?? interaction.channel;
		const user = options.getUser('user');
		const start = options.getString('start');
		const end = options.getString('end');
		const bots = options.getBoolean('bots') ?? false;
		const includes = options.getString('includes');
		const media = options.getString('media') as 'all' | 'embeds' | 'gifs' | 'images' | 'videos' | null;

		if ((start && !end) || (!start && end)) {
			yield* HandlerStep.from(
				{
					action: ActionKind.Reply,
					options: {
						content: 'You must provide both a start and end message id for range based purging',
					},
				},
				true,
			);
		}

		yield* HandlerStep.from({
			action: ActionKind.Reply,
			options: {
				content: 'Collecting messages...',
			},
		});

		const messages = await this.api.channels.getMessages(channel.id, { limit: 100 });

		yield* HandlerStep.from({
			action: ActionKind.Reply,
			options: {
				content: `Found ${messages.length} messages, filtering...`,
			},
		});

		const purgeList = messages
			.filter((message) => {
				const createdAt = DiscordSnowflake.timestampFrom(message.id);

				// Discord won't purge messages older than 2 weeks regardless
				const TWO_WEEKS = parseRelativeTime('2w');
				if (Date.now() - createdAt > TWO_WEEKS) {
					return false;
				}

				if (bots && !(message.author.bot || message.webhook_id)) {
					return false;
				}

				if (includes && !message.content.includes(includes)) {
					return false;
				}

				if (user && message.author.id !== user.id) {
					return false;
				}

				if (start) {
					const startCreatedAt = DiscordSnowflake.timestampFrom(start);
					if (createdAt < startCreatedAt) {
						return false;
					}
				}

				if (end) {
					const endCreatedAt = DiscordSnowflake.timestampFrom(end);
					if (createdAt > endCreatedAt) {
						return false;
					}
				}

				if (media) {
					const checkForExtension = (ext: string): boolean => {
						// eslint-disable-next-line no-useless-escape
						const expr = new RegExp(`https?://\\S+\.${ext}`, 'i');
						if (expr.test(message.content)) {
							return true;
						}

						return Boolean(message.attachments.some((a) => a.url.endsWith(`.${ext}`)));
					};

					const gifExt = ['gif', 'apng'];
					const imageExt = ['png', 'jpg', 'webp'];
					const videoExt = ['mp4', 'webm'];

					switch (media) {
						case 'all': {
							const allExt = [...gifExt, ...imageExt, ...videoExt];
							if (allExt.some(checkForExtension) || message.embeds.length > 0) {
								return false;
							}

							break;
						}

						case 'embeds': {
							if (message.embeds.length > 0) {
								return false;
							}

							break;
						}

						case 'gifs': {
							if (gifExt.some(checkForExtension)) {
								return false;
							}

							break;
						}

						case 'images': {
							if (imageExt.some(checkForExtension)) {
								return false;
							}

							break;
						}

						case 'videos': {
							if (videoExt.some(checkForExtension)) {
								return false;
							}

							break;
						}
					}
				}

				return true;
			})
			.sort((a, b) => {
				const aCreatedAt = DiscordSnowflake.timestampFrom(a.id);
				const bCreatedAt = DiscordSnowflake.timestampFrom(b.id);
				return bCreatedAt - aCreatedAt;
			})
			.slice(0, amount);

		if (!purgeList.length) {
			yield* HandlerStep.from(
				{
					action: ActionKind.Reply,
					options: {
						content: 'No messages found to purge. Are the only messages you want to delete older than 2 weeks?',
					},
				},
				true,
			);
		}

		yield* HandlerStep.from({
			action: ActionKind.Reply,
			options: {
				content: `Purging ${purgeList.length} messages...`,
			},
		});

		const reason = `Purge by ${interaction.member!.user.username}`;

		if (purgeList.length === 1) {
			const message = purgeList[0]!;
			await this.api.channels.deleteMessage(channel.id, message.id, { reason });
		} else {
			await this.api.channels.bulkDeleteMessages(
				channel.id,
				purgeList.map((message) => message.id),
				{ reason },
			);
		}

		yield* HandlerStep.from({
			action: ActionKind.Reply,
			options: {
				content: `Successfully purged ${purgeList.length} messages.`,
			},
		});
	}
}
