import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction, APIChatInputApplicationCommandInteraction } from '@discordjs/core';
import {
	ApplicationIntegrationType,
	ChannelType,
	InteractionContextType,
	MessageFlags,
	PermissionFlagsBits,
} from '@discordjs/core';
import { ChatInputInteractionOptionResolver } from '@sapphire/discord-utilities';
import type { FilterEvaluation } from '../lib/filterRunner.js';
import { evaluateFilters } from '../lib/filterRunner.js';

/**
 * `/simulate` (P5b): run the message filters over some text and say what would happen, without doing any of it.
 *
 * The port's diagnosability bias, made into a command. The question this answers -- "why did/didn't the filter
 * catch that" -- was legacy's most expensive one to answer, because the only way to find out was to post the
 * message and watch. Every gate is reported rather than just the verdict, so "the filter is off", "this channel
 * is exempt" and "the domain is allowlisted" are three visibly different answers.
 *
 * It calls `evaluateFilters` -- the same function the runner calls, not a copy of it. A simulator that
 * reimplements what it simulates agrees with production exactly until somebody needs it to.
 *
 * **Anti-spam is reported but not simulated** (P5c). It is the one filter that decides on a rate rather than on
 * content, so there is nothing about a pasted string to evaluate: running it would either record the simulated
 * message into the member's real window, or answer a question about how fast the moderator has been typing.
 * The command says which of the two it is doing rather than printing "nothing matched", which would read as a
 * verdict.
 */
const FILTER_NAME = {
	URLS: 'URL filter',
	INVITES: 'Invite filter',
} as const;

export default class SimulateCommand implements CommandHandler {
	public readonly name = 'simulate';

	public readonly data = new ChatInputCommandBuilder()
		.setName('simulate')
		.setDescription('Check what the message filters would do to a piece of text, without doing it')
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		// Manage Server rather than a moderation permission: this reads configuration and changes nothing, and
		// it is the same bar as the dashboard pages that set the allowlists it reports on.
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.addStringOptions((option) =>
			option.setName('content').setDescription('The message text to test').setRequired(true).setMaxLength(2_000),
		)
		.addChannelOptions((option) =>
			option
				.setName('channel')
				.setDescription('Pretend it was posted here (defaults to this channel) -- exemptions are per-channel')
				.addChannelTypes(
					ChannelType.GuildText,
					ChannelType.GuildAnnouncement,
					ChannelType.GuildVoice,
					ChannelType.PublicThread,
					ChannelType.PrivateThread,
					ChannelType.AnnouncementThread,
				),
		)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, _logger: Logger): Promise<void> {
		const api = getContext().service.client.api;

		if (!interaction.guild_id) {
			await api.interactions.reply(interaction.id, interaction.token, {
				content: 'This command can only be used in a server.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Deferred because the invite runner resolves every code over REST, which can outlast the three-second
		// interaction window on a cold cache.
		await api.interactions.defer(interaction.id, interaction.token, { flags: MessageFlags.Ephemeral });

		const options = new ChatInputInteractionOptionResolver(interaction as APIChatInputApplicationCommandInteraction);
		const content = options.getString('content', true);
		const channelId = options.getChannel('channel')?.id ?? interaction.channel.id;

		const evaluation = await evaluateFilters({
			guildId: interaction.guild_id,
			channelId,
			content,
			// Evaluated as a member holding no bypass roles, deliberately -- see `FilterEvaluationInput`. Anyone
			// with permission to run this necessarily holds the roles that would let them off, so passing their
			// own would make the command answer "nothing, you're staff" every single time.
			async resolveRoleIds() {
				return [];
			},
		});

		await api.interactions.editReply(interaction.application_id, interaction.token, {
			content: describe(evaluation, channelId),
			// The simulated text is echoed back inside the report; without this a `@everyone` in it would ping the
			// server from a command whose entire promise is that it has no effects.
			allowed_mentions: { parse: [] },
		});
	}
}

function describe(evaluation: FilterEvaluation, channelId: string): string {
	const lines: string[] = [`Simulated in <#${channelId}>, as a member with no bypass roles.`, ''];

	if (evaluation.enabled.length === 0) {
		return [
			...lines,
			'**Nothing would happen** — none of the message filters are turned on for this server.',
		].join('\n');
	}

	for (const kind of ['URLS', 'INVITES'] as const) {
		const name = FILTER_NAME[kind];

		if (!evaluation.enabled.includes(kind)) {
			lines.push(`• **${name}** — off for this server.`);
			continue;
		}

		const exemption = evaluation.exemptions.get(kind);
		if (exemption !== undefined) {
			// Names the channel that granted it rather than saying "exempt": the exemption is usually on the
			// category, and "which row do I delete to change this" is the next question.
			lines.push(`• **${name}** — did not run: <#${exemption}> is exempt.`);
			continue;
		}

		const verdict = evaluation.verdicts.find((entry) => entry.kind === kind);
		if (verdict) {
			lines.push(`• **${name}** — would trigger on: ${verdict.matched.map((value) => `\`${value}\``).join(', ')}`);
		} else {
			lines.push(`• **${name}** — ran, nothing matched.`);
		}
	}

	if (evaluation.enabled.includes('ANTISPAM')) {
		const exemption = evaluation.exemptions.get('ANTISPAM');
		lines.push(
			exemption === undefined
				? '• **Anti-spam** — on, but not simulated: it counts how fast messages arrive, not what they say.'
				: `• **Anti-spam** — would not run: <#${exemption}> is exempt.`,
		);
	} else {
		lines.push('• **Anti-spam** — off for this server.');
	}

	lines.push('');
	lines.push(
		evaluation.verdicts.length > 0
			? '**The message would be deleted** and the author DMed why.'
			: '**The message would be left alone.**',
	);

	return lines.join('\n');
}
