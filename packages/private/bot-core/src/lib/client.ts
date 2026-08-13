import { setInterval } from 'node:timers';
import type { GuildListKey } from '@chatsift/backend-core';
import { dropGuildList, getContext, primeUserCache, publishGuildList } from '@chatsift/backend-core';
import type { Snowflake } from '@discordjs/core';
import { InteractionType, Client, GatewayDispatchEvents } from '@discordjs/core';
import type { REST } from '@discordjs/rest';
import type { WebSocketManager } from '@discordjs/ws';
import {
	getCommandHandler,
	handleAutocompleteInteraction,
	handleCommandInteraction,
	registerCommandHandler,
} from './commands.js';
import { handleComponentInteraction } from './components.js';
import DashboardCommand from './dashboardCommand.js';
import DeployCommand from './deploy.js';
import { getReplicaIndex } from './replica.js';
import { onShutdown } from './shutdown.js';

declare module '@chatsift/backend-core' {
	interface ContextService {
		/**
		 * The full discord.js `Client`, so anything holding a `Context` can reach Discord without a direct import of
		 * this file (which would risk circular imports for modules the client construction depends on, like
		 * `lib/commands.ts`).
		 */
		client: Client;
	}
}

export interface CreateBotClientOptions {
	/**
	 * Identifies which bot this is for the `bot:<BotId>` guild-list Redis key that the dashboard/API reads to know
	 * which guilds the bot is in. A custom ModMail instance (#216) passes its own widened
	 * `` MODMAIL#${instanceId} `` key instead of the bare `BotId` so it doesn't overwrite the public
	 * deployment's guild list.
	 */
	readonly botId: GuildListKey;
	readonly gateway: WebSocketManager;
	readonly rest: REST;
}

/**
 * Builds the discord.js `Client` and wires up all gateway event routing: guild-set tracking with a periodic Redis
 * sync, interaction dispatch (component/command/autocomplete), and the fresh-app bootstrap that seeds `/deploy` as
 * the only global command so an admin has something to run. Also registers the shared `/deploy` and `/dashboard`
 * commands themselves, so callers never need to discover or wire either of them up on their own.
 *
 * Callers register the result into the context themselves (`setServiceValue('client', ...)`) before the rest of
 * the app starts — everything else should reach Discord via `getContext().service.client`, never by importing this
 * file.
 */
export function createBotClient({ botId, gateway, rest }: CreateBotClientOptions): Client {
	registerCommandHandler(new DeployCommand());
	registerCommandHandler(new DashboardCommand());

	// keep a copy of the guild ids we manage here to easily patch redis
	const guildIds = new Set<Snowflake>();

	const client = new Client({ rest, gateway });

	client
		// discord.js-core's Client re-emits a rejected async listener's error as an 'error' event; with no
		// listener for it here, Node's default EventEmitter behavior throws it as an uncaught exception and
		// takes the whole process down. This is a last-resort net for whatever call sites miss -- handlers with
		// a routine failure mode (e.g. a modal collector timing out) should still catch their own rejections.
		.on('error', (error) => {
			getContext().logger.error({ err: error }, 'Unhandled error in Discord client event listener');
		})
		.on(GatewayDispatchEvents.GuildCreate, ({ data: guild }) => {
			guildIds.add(guild.id);
		})
		.on(GatewayDispatchEvents.GuildDelete, ({ data: guild }) => {
			if (!guild.unavailable) {
				guildIds.delete(guild.id);
			}
		})
		.on(GatewayDispatchEvents.InteractionCreate, async ({ data: interaction }) => {
			// Discord's own interaction id is already a unique, stable correlation key -- no need to mint one
			// ourselves the way the API service does with a `nanoid`. This child logger flows into every
			// handler for the interaction, so the whole course of it can be traced by `interactionId`. `guildId`
			// is `null` (rather than omitted) for interactions that happen outside a guild (DMs), so every log
			// line consistently carries the key either way (see issue #242).
			const logger = getContext().logger.child({
				interactionId: interaction.id,
				interactionType: interaction.type,
				guildId: interaction.guild_id ?? null,
			});

			// Every interaction payload already carries the acting user's full profile, so warming the shared
			// user cache from it costs nothing and saves a real Discord request later. This is what makes an
			// AMA questions page cheap to load: each author was cached the moment they submitted, rather than
			// being fetched one-by-one months later through a bucket that allows 30 requests per 30 seconds.
			// `member.user` in a guild, `user` in DMs -- both are the same global user object.
			const actingUser = interaction.member?.user ?? interaction.user;
			if (actingUser) {
				primeUserCache(actingUser);
			}

			if (interaction.type === InteractionType.MessageComponent) {
				await handleComponentInteraction(interaction, logger);
			} else if (interaction.type === InteractionType.ApplicationCommand) {
				await handleCommandInteraction(interaction, logger);
			} else if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
				await handleAutocompleteInteraction(interaction, logger);
			} else {
				logger.warn('Unhandled interaction type');
			}
		})
		.once(GatewayDispatchEvents.Ready, async ({ data }) => {
			getContext().logger.info('Logged in successfully');

			// `.once` makes this fire a single time per *process*, which stops being "once" as soon as a bot runs
			// more than one replica: each would independently see zero global commands and each would bulk-overwrite.
			// The claim is taken before the check below rather than around just the write, so two replicas can't both
			// pass the emptiness test and race. A short expiry (rather than a permanent key) keeps this self-healing:
			// if the replica holding the claim dies before deploying, the next restart retries instead of leaving the
			// application with no commands at all and no way to bootstrap.
			const bootstrapClaimed = await getContext().redis.set(`deploybootstrap:${botId}`, '1', {
				condition: 'NX',
				expiration: { type: 'PX', value: 5 * 60 * 1_000 },
			});
			if (!bootstrapClaimed) {
				return;
			}

			const applicationId = data.application.id;
			const existingGlobalCommands = await client.api.applicationCommands.getGlobalCommands(applicationId);
			if (existingGlobalCommands.length === 0) {
				const deployHandler = getCommandHandler('deploy');
				if (deployHandler) {
					await client.api.applicationCommands.bulkOverwriteGlobalCommands(applicationId, [deployHandler.data]);
					getContext().logger.info('Bootstrapped deploy command as the only global command');
				} else {
					getContext().logger.warn('No deploy command handler found; skipping global command bootstrap');
				}
			}
		});

	setInterval(async () => {
		try {
			await publishGuildList(botId, getReplicaIndex(), [...guildIds]);
		} catch (error) {
			getContext().logger.error({ err: error }, 'Failed to sync guild list to Redis');
		}
	}, 10_000).unref();

	// Without this the slice lingers for its TTL after a deliberate restart, so the dashboard keeps crediting this
	// replica with guilds nothing is currently receiving events for.
	onShutdown('guild-list', async () => dropGuildList(botId, getReplicaIndex()));

	return client;
}
