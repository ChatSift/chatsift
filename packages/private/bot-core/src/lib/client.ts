import process from 'node:process';
import { setInterval } from 'node:timers';
import type { GuildListKey } from '@chatsift/backend-core';
import {
	addGuildToList,
	countGuildList,
	dropGuildList,
	getContext,
	guildListExists,
	primeUserCache,
	removeGuildFromList,
	syncShardGuildList,
	touchGuildList,
} from '@chatsift/backend-core';
import type { Snowflake } from '@discordjs/core';
import { InteractionType, Client, GatewayDispatchEvents } from '@discordjs/core';
import type { REST } from '@discordjs/rest';
import type { WebSocketManager } from '@discordjs/ws';
import { Gauge, type Registry } from 'prom-client';
import { handleAutocompleteInteraction, handleCommandInteraction, registerCommandHandler } from './commands.js';
import { handleComponentInteraction } from './components.js';
import DashboardCommand from './dashboardCommand.js';
import DeployCommand, { bootstrapGlobalCommands } from './deploy.js';
import { getReplicaIndex, ownsShardForGuild, shardOwnsGuild } from './replica.js';
import { setSelfId } from './selfId.js';
import { invalidateStoredSessions } from './sessions.js';
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
	 * Identifies which bot this is for the `guilds:<BotId>:<replica>` guild-list Redis keys that the dashboard/API
	 * reads to know which guilds the bot is in. A custom ModMail instance (#216) passes its own widened
	 * `` MODMAIL#${instanceId} `` key instead of the bare `BotId` so it doesn't overwrite the public
	 * deployment's guild list.
	 */
	readonly botId: GuildListKey;
	readonly gateway: WebSocketManager;
	/**
	 * The bot's own `prom-client` registry, if it has one. Optional for the same reason `createBotRest`'s is:
	 * the client has to stand up without it in tests. Omitting it drops `discord_guilds`, nothing else.
	 */
	readonly register?: Registry;
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
export function createBotClient({ botId, gateway, register, rest }: CreateBotClientOptions): Client {
	registerCommandHandler(new DeployCommand());
	registerCommandHandler(new DashboardCommand());

	const client = new Client({ rest, gateway });

	/**
	 * How many guilds *this replica* is receiving gateway events for, so `sum by (job) (discord_guilds)` is the
	 * bot's fleet total -- slices are disjoint by shard ownership, so replicas never double-count each other.
	 *
	 * Shared, unprefixed name across all four bots rather than an `ama_guilds`/`modmail_guilds` set, exactly like
	 * `discord_requests_total` in `rest.ts`: Prometheus's own `job` label already says which bot a series belongs
	 * to, and one name is what lets a single panel compare them.
	 *
	 * **Deliberately not zero-initialised.** Every other metric in this stack is (see the note in each bot's
	 * `metrics.ts`), because a counter that never fires reads as "No data" rather than `0`. Here the opposite is
	 * true: a replica that has not identified yet is in an unknown number of guilds, not zero, and seeding `0`
	 * would make every rolling restart dip the fleet total. READY always fires, so the series always appears.
	 */
	const guildCount = register
		? new Gauge({
				name: 'discord_guilds',
				help: 'Guilds this replica is receiving gateway events for',
				labelNames: ['bot'] as const,
				registers: [register],
			})
		: null;

	// A custom ModMail instance's `MODMAIL#<slug>` key would split its series away from the public deployment's,
	// and Prometheus already separates the two with a `modmail_instance` target label it relabels from DNS. So
	// this carries the bare `BotId`, matching what `createBotRest` labels `discord_requests_total` with.
	const bot = botId.split('#')[0]!;

	async function publishGuildCount(): Promise<void> {
		if (!guildCount) {
			return;
		}

		try {
			guildCount.set({ bot }, await countGuildList(botId, getReplicaIndex()));
		} catch (error) {
			// A gauge that misses an update leaves a gap in a chart; letting it throw would take down whichever
			// caller it interrupted -- READY's command bootstrap, or the heartbeat's expiry detection.
			getContext().logger.warn({ err: error, botId }, 'Failed to publish the guild count');
		}
	}

	// The heartbeat below starts ticking as soon as the client is built, which is before the shard has identified
	// -- and there is no bound on how long that takes (identify throttling across shards, a session-start rate
	// limit, a slow gateway). Until the first READY/RESUMED has published a slice there is no state to lose, so
	// treating the absent key as expiry would kill the process for the crime of still starting up.
	let publishing = false;

	// Losing the guild set is unrecoverable from a resumed session without a massive amount of API requests
	async function recoverLostGuildList(reason: string): Promise<void> {
		publishing = false;
		getContext().logger.error({ botId, reason }, 'lost the guild list, dropping the session to force a re-identify');

		try {
			await invalidateStoredSessions();
		} catch (error) {
			getContext().logger.error({ err: error, botId }, 'failed to invalidate sessions before restarting');
		}

		process.kill(process.pid, 'SIGTERM');
	}

	// Runs on Ready *and* Resumed, guarded rather than `.once`, for the same reason the guild list is kept in
	// redis: since the session store, an ordinary restart replays as RESUMED, so a Ready-only hook stops firing
	// after the application's first boot ever. RESUMED carries no payload, hence the application-id fetch.
	// Deduplicated by the in-flight promise rather than a "started" flag. A flag set before the async work
	// suppresses concurrent events correctly but also makes a *failure* permanent: one 503 on the
	// application-id lookup and this process never seeds `/deploy` again, however many times it reconnects.
	// Clearing on failure lets the next gateway event retry, while a success stays suppressed forever.
	let bootstrap: Promise<void> | null = null;
	const bootstrapOnce = async (applicationId?: Snowflake): Promise<void> => {
		bootstrap ??= (async () => {
			try {
				const resolvedId = applicationId ?? (await client.api.oauth2.getCurrentBotApplicationInformation()).id;
				await bootstrapGlobalCommands(botId, resolvedId, client.api.applicationCommands);
			} catch (error) {
				// Never fatal: a bot that can't seed `/deploy` still works for every guild that already has its
				// commands, and taking the process down over it would turn a cosmetic gap into an outage.
				getContext().logger.error({ err: error }, 'Failed to bootstrap global commands');
				// Cleared here rather than left set, so the next Ready/Resumed retries instead of inheriting a
				// permanent failure. Safe to reassign mid-flight: callers captured the promise before this ran.
				bootstrap = null;
			}
		})();

		await bootstrap;
	};

	client
		// discord.js-core's Client re-emits a rejected async listener's error as an 'error' event; with no
		// listener for it here, Node's default EventEmitter behavior throws it as an uncaught exception and
		// takes the whole process down. This is a last-resort net for whatever call sites miss -- handlers with
		// a routine failure mode (e.g. a modal collector timing out) should still catch their own rejections.
		.on('error', (error) => {
			getContext().logger.error({ err: error }, 'Unhandled error in Discord client event listener');
		})
		.on(GatewayDispatchEvents.GuildCreate, async ({ data: guild }) => {
			await addGuildToList(botId, getReplicaIndex(), guild.id);
		})
		.on(GatewayDispatchEvents.GuildDelete, async ({ data: guild }) => {
			if (!guild.unavailable) {
				await removeGuildFromList(botId, getReplicaIndex(), guild.id);
			}
		})
		.on(GatewayDispatchEvents.Resumed, async () => {
			getContext().logger.info('Resumed an existing session');

			if (!(await guildListExists(botId, getReplicaIndex()))) {
				await recoverLostGuildList('no guild list to resume onto');
				return;
			}

			publishing = true;

			await bootstrapOnce();
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
		.on(GatewayDispatchEvents.Ready, async ({ data, shardId }) => {
			getContext().logger.info({ shardId }, 'Logged in successfully');

			// Free here, and the only place it arrives without a request -- see `selfId.ts` for why a bot that
			// only ever RESUMEs has to fall back to asking. Guarded, and deliberately so: this handler's real job
			// is the guild-list sync and the command bootstrap below, and a recording step that can throw ahead
			// of them would take both down with it.
			if (data.user?.id) {
				setSelfId(data.user.id);
			}

			// READY already names every guild this shard is in (as unavailable stubs), so the slice can be
			// reconciled against it here rather than cleared and rebuilt from the GUILD_CREATE sweep that
			// follows -- see `syncShardGuildList` for the two races clearing it opened.
			await syncShardGuildList(
				botId,
				getReplicaIndex(),
				data.guilds.map((guild) => guild.id),
				// What this shard's READY speaks for: its own guilds, plus anything this replica has no shard for
				// at all. Discord raising its shard count remaps every guild, and a member stranded by that would
				// otherwise be kept alive by the heartbeat forever, since no shard here would ever claim it.
				(guildId) => shardOwnsGuild(shardId, guildId) || !ownsShardForGuild(guildId),
			);
			publishing = true;

			// Published here rather than left to the heartbeat below so a bot whose first scrape lands inside the
			// first ten seconds of its life reports the guilds it already has, not an absent series. READY names
			// every guild this shard is in, so the count is complete the moment the sync above returns.
			await publishGuildCount();

			await bootstrapOnce(data.application.id);
		});

	// A heartbeat, not a republish: the set is maintained per event, so this only re-arms its TTL. A key that is
	// already gone (a redis outage outlasting the TTL) is the same lost-state condition the resume path handles,
	// and is recovered the same way rather than left to run empty.
	setInterval(async () => {
		if (!publishing) {
			return;
		}

		try {
			if (!(await touchGuildList(botId, getReplicaIndex()))) {
				await recoverLostGuildList('guild list expired while running');
				return;
			}
		} catch (error) {
			getContext().logger.error({ err: error }, 'Failed to refresh the guild list TTL');
			return;
		}

		// One `SCARD` on the tick that already talks to redis, rather than a write on every GUILD_CREATE -- a cold
		// boot delivers one of those per guild, and the gauge only has to be fresher than the 15s scrape interval.
		await publishGuildCount();
	}, 10_000).unref();

	// Without this the slice lingers for its TTL after a deliberate restart, so the dashboard keeps crediting this
	// replica with guilds nothing is currently receiving events for.
	onShutdown('guild-list', async () => dropGuildList(botId, getReplicaIndex()));

	return client;
}
