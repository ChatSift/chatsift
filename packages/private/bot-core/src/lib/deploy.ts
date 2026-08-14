import type { GuildListKey, Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction, Snowflake } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags } from '@discordjs/core';
import type { CommandHandler } from './commands.js';
import { getAllCommandsData, getCommandHandler } from './commands.js';

/**
 * How long the bootstrap claim survives if the process dies while holding it. A backstop only -- the happy
 * paths all release it explicitly, see `bootstrapGlobalCommands`.
 */
const BOOTSTRAP_CLAIM_TTL_MS = 5 * 60 * 1_000;

/**
 * The narrow slice of `client.api.applicationCommands` the bootstrap needs, so it can be exercised without
 * standing up a whole `Client`.
 */
export interface GlobalCommandsAPI {
	bulkOverwriteGlobalCommands(applicationId: Snowflake, commands: CommandHandler['data'][]): Promise<unknown>;
	getGlobalCommands(applicationId: Snowflake): Promise<unknown[]>;
}

/**
 * Seeds `/deploy` as the only global command on an application that has none, so a fresh (or freshly cleared)
 * application has something for an admin to run. Called once per process from `createBotClient`'s Ready
 * handler.
 *
 * The redis claim exists because `.once` stops meaning "once" as soon as a bot runs more than one replica
 * (#355): each would independently see zero global commands and each would bulk-overwrite. It is taken before
 * the emptiness check rather than around just the write, so two replicas can't both pass the test and race.
 *
 * **It is released on every path, not left to expire.** Holding it past the decision conflates "somebody is
 * bootstrapping right now" with "somebody looked recently", and the second one is not a thing worth blocking
 * on: a boot that finds commands already present would otherwise lock out the next five minutes of boots,
 * including one that genuinely needed to deploy. That is precisely what broke after the global command set was
 * cleared by hand -- the boot before the clear checked, found commands, did nothing, and kept the claim.
 *
 * Releasing after a *successful* deploy is safe for the same reason the claim is narrow: anyone claiming
 * afterwards reads a non-empty command list and does nothing. A replica that somehow reads a stale empty list
 * writes the identical single command again, which is idempotent.
 */
export async function bootstrapGlobalCommands(
	botId: GuildListKey,
	applicationId: Snowflake,
	api: GlobalCommandsAPI,
): Promise<void> {
	const { logger, redis } = getContext();
	const claimKey = `deploybootstrap:${botId}`;

	const claimed = await redis.set(claimKey, '1', {
		condition: 'NX',
		expiration: { type: 'PX', value: BOOTSTRAP_CLAIM_TTL_MS },
	});
	if (!claimed) {
		return;
	}

	try {
		const existing = await api.getGlobalCommands(applicationId);
		if (existing.length > 0) {
			return;
		}

		const deployHandler = getCommandHandler('deploy');
		if (!deployHandler) {
			logger.warn('No deploy command handler found; skipping global command bootstrap');
			return;
		}

		await api.bulkOverwriteGlobalCommands(applicationId, [deployHandler.data]);
		logger.info('Bootstrapped deploy command as the only global command');
	} finally {
		await redis.del(claimKey);
	}
}

/**
 * Shared by every bot — admin-gated (`env.ADMINS`), bulk-overwrites the **global** command set
 * (`bulkOverwriteGlobalCommands`) from every command handler currently registered for the process, including
 * itself (omitting it would delete `/deploy` on its own next run). `createBotClient` registers this
 * automatically, so services never need to discover or wire it up themselves.
 */
export default class DeployCommand implements CommandHandler {
	public readonly name = 'deploy';

	public readonly data = new ChatInputCommandBuilder()
		.setName('deploy')
		.setDescription('Bulk-overwrite all global commands with every registered command handler')
		.setContexts(InteractionContextType.BotDM)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger) {
		const userId = interaction.user?.id;
		if (!userId || !getContext().env.ADMINS.has(userId)) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'You are not authorized to run this command.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await getContext().service.client.api.interactions.defer(interaction.id, interaction.token, {
			flags: MessageFlags.Ephemeral,
		});

		try {
			const commandsData = getAllCommandsData();
			await getContext().service.client.api.applicationCommands.bulkOverwriteGlobalCommands(
				interaction.application_id,
				commandsData,
			);

			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content: `Deployed ${commandsData.length} global command(s).`,
			});
		} catch (error) {
			logger.error({ err: error }, 'Failed to deploy global commands');

			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content: 'Failed to deploy commands. Check the logs.',
			});
		}
	}
}
