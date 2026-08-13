import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction, APIChatInputApplicationCommandInteraction } from '@discordjs/core';
import {
	ApplicationIntegrationType,
	AutoModerationRuleEventType,
	AutoModerationRuleTriggerType,
	AutoModerationActionType,
	InteractionContextType,
	MessageFlags,
	PermissionFlagsBits,
} from '@discordjs/core';
import { ChatInputInteractionOptionResolver } from '@sapphire/discord-utilities';

const SPIKE_RULE_NAME = 'ChatSift spike';

/**
 * P0's AutoMod spike (docs/roadmap/11-automoderator-port.md).
 *
 * Feature 01 delegates banword *matching* to Discord and keeps only the response layer, keying policy on
 * `matched_keyword`. Two things have to be true for that to work, and both are cheaper to disprove now than
 * after P5 is built on them:
 *
 * 1. The bot can **read and write** a guild's native AutoMod rules — the dashboard's banword editor is a
 *    front-end over Discord's rules, not just over our own table, so this is a hard requirement rather than a
 *    convenience.
 * 2. Tripping a rule produces an `AUTO_MODERATION_ACTION_EXECUTION` carrying a usable `matched_keyword` —
 *    proven by `lib/automodIntake.ts`, which this command exists to give something to trip.
 *
 * Admin-gated on `ENV.ADMINS` like `/deploy`, not on guild permissions: this writes real guild configuration
 * and is a diagnostic, not a product feature. It is expected to be deleted at P5, once the real banword
 * surface replaces it.
 */
export default class AutomodSpikeCommand implements CommandHandler {
	public readonly name = 'automod-spike';

	public readonly data = new ChatInputCommandBuilder()
		.setName('automod-spike')
		.setDescription("Inspect or seed this server's native Discord AutoMod rules (diagnostic)")
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.addSubcommands(
			(subcommand) => subcommand.setName('rules').setDescription("List this server's AutoMod rules"),
			(subcommand) =>
				subcommand
					.setName('seed')
					.setDescription('Create a keyword rule that blocks one word, so the round trip can be tripped')
					.addStringOptions((option) =>
						option.setName('keyword').setDescription('The word to block').setRequired(true),
					),
		)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger): Promise<void> {
		const api = getContext().service.client.api;

		const reply = async (content: string) => {
			await api.interactions.reply(interaction.id, interaction.token, { content, flags: MessageFlags.Ephemeral });
		};

		const userId = interaction.member?.user.id ?? interaction.user?.id;
		if (!userId || !getContext().env.ADMINS.has(userId)) {
			await reply('You are not authorized to run this command.');
			return;
		}

		if (!interaction.guild_id) {
			await reply('This command can only be used in a server.');
			return;
		}

		const options = new ChatInputInteractionOptionResolver(interaction as APIChatInputApplicationCommandInteraction);
		const subcommand = options.getSubcommand(true);

		await api.interactions.defer(interaction.id, interaction.token, { flags: MessageFlags.Ephemeral });
		const editReply = async (content: string) => {
			await api.interactions.editReply(interaction.application_id, interaction.token, { content });
		};

		try {
			if (subcommand === 'rules') {
				const rules = await api.guilds.getAutoModerationRules(interaction.guild_id);
				logger.info({ ruleCount: rules.length }, 'read the guild AutoMod rules');

				if (rules.length === 0) {
					// Worth saying explicitly: this is the state in which the whole banword feature is silently
					// inert for a guild, and P5's dashboard has to surface it rather than showing an
					// empty-but-healthy page.
					await editReply('This server has no AutoMod rules, so no action executions will ever be sent.');
					return;
				}

				const described = rules.map((rule) => {
					const keywords = rule.trigger_metadata?.keyword_filter ?? [];
					const actions = rule.actions.map((action) => AutoModerationActionType[action.type] ?? action.type);
					return `- **${rule.name}** (\`${rule.id}\`) — trigger ${AutoModerationRuleTriggerType[rule.trigger_type] ?? rule.trigger_type}, ${keywords.length} keyword(s), actions: ${actions.join(', ')}${rule.enabled ? '' : ' *(disabled)*'}`;
				});

				await editReply(`${rules.length} rule(s):\n${described.join('\n')}`);
				return;
			}

			const keyword = options.getString('keyword', true);

			const rule = await api.guilds.createAutoModerationRule(
				interaction.guild_id,
				{
					name: `${SPIKE_RULE_NAME}: ${keyword}`,
					event_type: AutoModerationRuleEventType.MessageSend,
					trigger_type: AutoModerationRuleTriggerType.Keyword,
					trigger_metadata: { keyword_filter: [keyword] },
					// BlockMessage, so the round trip being proven is the one feature 01 actually relies on:
					// Discord suppresses the message before we ever see the event, and our side supplies only
					// the response. Feature 30 ("report instead of delete") is the same rule configured to
					// alert rather than block.
					actions: [{ type: AutoModerationActionType.BlockMessage }],
					enabled: true,
				},
				{ reason: 'AutoMod spike (P0)' },
			);

			logger.info({ ruleId: rule.id, keyword }, 'created an AutoMod keyword rule');
			await editReply(
				`Created rule \`${rule.id}\` blocking **${keyword}**. Send that word in a channel — the bot should log an ` +
					'`automoderator decision: automod` line carrying it as `matched`. Delete the rule from Server Settings ' +
					'→ AutoMod when done.',
			);
		} catch (error) {
			// The likely failures are both informative rather than incidental: 403 means the bot lacks Manage
			// Server, and 400 on create usually means the guild is at Discord's six-keyword-rule ceiling --
			// which is exactly the limit P9's migration has to have an answer for.
			logger.error({ err: error, subcommand }, 'AutoMod spike command failed');
			await editReply('That failed. Check the logs — a 403 means the bot is missing Manage Server.');
		}
	}
}
