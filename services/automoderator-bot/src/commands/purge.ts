import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { PermissionsBitField } from '@chatsift/core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type {
	APIApplicationCommandInteraction,
	APIChatInputApplicationCommandInteraction,
	APIMessage,
	API,
} from '@discordjs/core';
import {
	ApplicationIntegrationType,
	ChannelType,
	InteractionContextType,
	MessageFlags,
	PermissionFlagsBits,
} from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { ChatInputInteractionOptionResolver } from '@sapphire/discord-utilities';
import { executeAction } from '../lib/actionExecutor.js';
import type { CaseActor } from '../lib/cases.js';
import { actorFromUser } from '../lib/cases.js';
import { REASON_MAX_LENGTH } from '../lib/modCommandOptions.js';
import { buildAuditReason } from '../lib/moderation.js';
import type { PurgeCriteria, PurgeMediaKind } from '../lib/purge.js';
import {
	chunkForBulkDelete,
	isPastPurgeRange,
	PURGE_MAX_AMOUNT,
	PURGE_MAX_SCAN,
	selectPurgeTargets,
} from '../lib/purge.js';

/**
 * `/purge` (P6, feature 24): clear recent messages matching whatever combination of filters a moderator gives.
 *
 * The selection rules live in `lib/purge.ts` and are tested there; this owns the Discord half -- paging back
 * through the channel, checking that the moderator may act in the channel they named, and deleting in batches.
 *
 * **Reads the channel rather than the message cache.** Legacy filtered its redis cache plus the last hundred
 * messages, which cannot work here: this bot's cache deliberately holds no bot or webhook messages
 * (`isLoggableMessage`), so `bots:true` -- the filter people reach for most -- would have matched nothing at
 * all. The channel is also the only source that is right about deletions and edits that happened since.
 */
const PAGE_SIZE = 100;

/**
 * What a bare `amount` defaults to. Legacy defaulted to a hundred; fifty is half a screen of scrollback, and a
 * moderator who wants more can say so -- the number that gets typed by accident should be the smaller one.
 */
const DEFAULT_AMOUNT = 50;

const SNOWFLAKE = /^\d{17,20}$/;

const MEDIA_CHOICES = [
	{ name: 'Anything with media or an embed', value: 'all' },
	{ name: 'Embeds (link previews, bot embeds)', value: 'embeds' },
	{ name: 'Images', value: 'images' },
	{ name: 'GIFs', value: 'gifs' },
	{ name: 'Videos', value: 'videos' },
] as const satisfies readonly { name: string; value: PurgeMediaKind }[];

export default class PurgeCommand implements CommandHandler {
	public readonly name = 'purge';

	public readonly data = new ChatInputCommandBuilder()
		.setName('purge')
		.setDescription('Delete recent messages matching what you describe')
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
		.addIntegerOptions((option) =>
			option
				.setName('amount')
				.setDescription(`How many messages to delete at most (default ${DEFAULT_AMOUNT})`)
				.setMinValue(1)
				.setMaxValue(PURGE_MAX_AMOUNT),
		)
		.addChannelOptions((option) =>
			option
				.setName('channel')
				.setDescription('Where to delete from (defaults to this channel)')
				.addChannelTypes(
					ChannelType.GuildText,
					ChannelType.GuildAnnouncement,
					ChannelType.GuildVoice,
					ChannelType.PublicThread,
					ChannelType.PrivateThread,
					ChannelType.AnnouncementThread,
				),
		)
		.addUserOptions((option) => option.setName('user').setDescription('Only messages from this member'))
		.addBooleanOptions((option) => option.setName('bots').setDescription('Only messages from bots and webhooks'))
		.addStringOptions((option) =>
			option.setName('includes').setDescription('Only messages containing this text').setMaxLength(REASON_MAX_LENGTH),
		)
		.addStringOptions((option) => option.setName('start').setDescription('Only messages posted after this message id'))
		.addStringOptions((option) => option.setName('end').setDescription('Only messages posted before this message id'))
		.addStringOptions((option) =>
			option
				.setName('media')
				.setDescription('Only messages carrying this kind of media')
				.setChoices(...MEDIA_CHOICES),
		)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger): Promise<void> {
		const api = getContext().service.client.api;

		if (!interaction.guild_id || !interaction.member) {
			await api.interactions.reply(interaction.id, interaction.token, {
				content: 'This command can only be used in a server.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await api.interactions.defer(interaction.id, interaction.token, { flags: MessageFlags.Ephemeral });

		const reply = async (content: string) => {
			await api.interactions.editReply(interaction.application_id, interaction.token, {
				content,
				// The `includes` filter is echoed back in the summary, so a purge of `@everyone` spam must not
				// itself ping the server.
				allowed_mentions: { parse: [] },
			});
		};

		const options = new ChatInputInteractionOptionResolver(interaction as APIChatInputApplicationCommandInteraction);
		const channel = options.getChannel('channel');
		const amountOption = options.getInteger('amount');
		const user = options.getUser('user');
		const botsOnly = options.getBoolean('bots');
		const includes = options.getString('includes');
		const start = options.getString('start');
		const end = options.getString('end');
		const media = options.getString('media') as PurgeMediaKind | null;

		// Legacy's rule, kept: a bare `/purge` is a mistype away from clearing a channel, and every other use of
		// it names at least one thing. `amount` counts -- "delete the last 20 messages" is a deliberate request.
		if (
			amountOption === null &&
			channel === null &&
			user === null &&
			botsOnly === null &&
			includes === null &&
			start === null &&
			end === null &&
			media === null
		) {
			await reply('Tell me what to delete: an `amount`, a `user`, `bots`, `includes`, a message range, or `media`.');
			return;
		}

		// Discord evaluates a command's `default_member_permissions` in the channel it was run in, so the only
		// gap is a moderator naming a *different* channel -- one they may not hold Manage Messages in, or may
		// not be able to see at all. The resolved channel carries their computed permissions for it, so closing
		// that gap costs no requests.
		//
		// The *invoking* channel deliberately gets no equivalent check, and a reviewer reading this as a hole
		// should read it as a decision instead: a guild that hands `/purge` to a role through Discord's command
		// overrides has authorized exactly that, the same way it can hand `/ban` to a role holding no Ban
		// Members -- which is the usual way a server gives junior staff bot-mediated powers without native ones.
		// Re-checking the native permission here would break that on `/purge` alone while `/ban` still allows
		// it. See `permissions.ts`, which records why the report card is the one place in this bot that does
		// re-check: there the action is chosen *after* the interaction was authorized, so the command name
		// gates nothing.
		if (channel && !PermissionsBitField.any(BigInt(channel.permissions), PermissionFlagsBits.ManageMessages)) {
			await reply(`You do not have permission to manage messages in <#${channel.id}>.`);
			return;
		}

		for (const [name, value] of [
			['start', start],
			['end', end],
		] as const) {
			if (value !== null && !SNOWFLAKE.test(value)) {
				await reply(`\`${name}\` has to be a message id. Right-click a message and pick "Copy Message ID".`);
				return;
			}
		}

		if (start !== null && end !== null && BigInt(start) >= BigInt(end)) {
			await reply('`start` has to be an older message than `end`.');
			return;
		}

		const channelId = channel?.id ?? interaction.channel.id;
		const amount = amountOption ?? DEFAULT_AMOUNT;
		const criteria: PurgeCriteria = {
			...(user ? { authorId: user.id } : {}),
			...(botsOnly === null ? {} : { botsOnly }),
			...(includes === null ? {} : { includes }),
			...(media === null ? {} : { media }),
			...(start === null ? {} : { newerThanId: start }),
			...(end === null ? {} : { olderThanId: end }),
		};

		try {
			const { targets, scanned } = await collect(api, channelId, criteria, amount);

			if (targets.length === 0) {
				// "the ${scanned} I checked" rather than "the last ${scanned}": with `end` given the walk starts
				// there rather than at the newest message, so "the last N" would name a stretch of the channel that
				// was never read.
				await reply(
					`Nothing matched in the ${scanned} message${scanned === 1 ? '' : 's'} I checked in <#${channelId}>. Discord only lets me delete messages from the past two weeks.`,
				);
				return;
			}

			const outcome = await purge(
				api,
				{ guildId: interaction.guild_id, channelId, moderator: actorFromUser(interaction.member.user) },
				targets,
				logger,
			);
			await reply(describeOutcome(outcome, targets.length, scanned, channelId));
		} catch (error) {
			logger.error({ err: error, guildId: interaction.guild_id, channelId }, 'a purge failed');
			await reply(
				`Something went wrong reading <#${channelId}>. Check that I can see it and read its history, then try again.`,
			);
		}
	}
}

/**
 * Pages backwards through the channel until enough matches are found, the scan budget runs out, or nothing
 * older can possibly match.
 */
async function collect(
	api: API,
	channelId: string,
	criteria: PurgeCriteria,
	amount: number,
): Promise<{ scanned: number; targets: string[] }> {
	const targets: string[] = [];
	let scanned = 0;
	// `end` is where the walk starts rather than a filter that throws pages away: paging from the newest message
	// to reach a range that ended an hour ago would spend the whole scan budget before arriving.
	let before = criteria.olderThanId;

	while (targets.length < amount && scanned < PURGE_MAX_SCAN) {
		const page: APIMessage[] = await api.channels.getMessages(channelId, {
			limit: PAGE_SIZE,
			...(before === undefined ? {} : { before }),
		});

		if (page.length === 0) {
			break;
		}

		scanned += page.length;
		targets.push(...selectPurgeTargets(page, criteria, amount - targets.length));

		const oldest = page.at(-1)!;
		before = oldest.id;

		// A short page is the start of the channel. `isPastPurgeRange` is the other stop: everything further
		// back is either older than Discord will bulk-delete or older than `start`.
		if (page.length < PAGE_SIZE || isPastPurgeRange(oldest, criteria)) {
			break;
		}
	}

	return { targets, scanned };
}

interface PurgeOutcome {
	readonly deleted: number;
	/**
	 * Whether the channel refused us outright, which is the difference between "I cannot do this" and "some of
	 * those messages were already gone" -- two failures that call for opposite follow-up from a moderator.
	 */
	readonly permissionDenied: boolean;
}

/**
 * Deletes the selection in bulk-delete-sized batches, returning how many actually went.
 *
 * One `executeAction` per batch rather than one around the whole purge, which is the shape `filterRunner.ts`
 * uses: a purge is many independent calls, and wrapping them together would report a hundred deleted messages
 * as one action and lose the count entirely if the last batch failed.
 */
async function purge(
	api: API,
	target: { channelId: string; guildId: string; moderator: CaseActor },
	targets: readonly string[],
	logger: Logger,
): Promise<PurgeOutcome> {
	const { channelId, guildId, moderator } = target;
	const reason = buildAuditReason(moderator, 'purge');
	let deleted = 0;

	for (const chunk of chunkForBulkDelete(targets)) {
		try {
			await executeAction(
				{
					action: 'delete',
					guildId,
					source: 'command',
					targetId: moderator.id,
					async execute() {
						// Bulk delete refuses a single-message body, and a purge lands on exactly one message often
						// enough (a narrow `includes`, a quiet channel) for this to be the common path rather than an
						// edge case.
						if (chunk.length === 1) {
							await api.channels.deleteMessage(channelId, chunk[0]!, { reason });
							return;
						}

						await api.channels.bulkDeleteMessages(channelId, chunk, { reason });
					},
				},
				logger,
			);

			deleted += chunk.length;
		} catch (error) {
			// **Only a 403 stops the purge.** That one is the channel refusing us, so every remaining batch fails
			// identically and continuing would be a hundred requests to be told no a hundred times.
			//
			// Everything else is usually one id out of a hundred: Discord rejects a bulk delete *whole* when a
			// single message in it has already gone, which is exactly what a second moderator cleaning up the
			// same channel produces. Breaking there would let one stale id abort a purge that could still finish.
			if (error instanceof DiscordAPIError && error.status === 403) {
				logger.warn({ err: error, channelId, deleted }, 'a purge was refused, stopping');
				return { deleted, permissionDenied: true };
			}

			logger.warn({ err: error, channelId, deleted }, 'a purge batch failed, skipping it');
		}
	}

	return { deleted, permissionDenied: false };
}

function describeOutcome(outcome: PurgeOutcome, selected: number, scanned: number, channelId: string): string {
	const { deleted, permissionDenied } = outcome;

	if (deleted === 0) {
		return permissionDenied
			? `I could not delete anything in <#${channelId}>. Check that I have Manage Messages there.`
			: `I could not delete anything in <#${channelId}>. Everything I found had already been removed by the time I got to it.`;
	}

	const head = `Deleted ${deleted} message${deleted === 1 ? '' : 's'} in <#${channelId}>.`;

	if (deleted < selected) {
		const missed = selected - deleted;

		return permissionDenied
			? `${head} ${missed} more matched but I was refused. Check my permissions in that channel.`
			: `${head} ${missed} more matched but were gone before I got to them.`;
	}

	// Only worth saying when the scan is what stopped it: otherwise the channel simply had nothing else to give,
	// and "I only looked at 40 messages" reads as a limitation rather than as the end of the channel.
	if (scanned >= PURGE_MAX_SCAN) {
		return `${head} That is as far back as one purge looks (${PURGE_MAX_SCAN} messages). Run it again to keep going.`;
	}

	return head;
}
