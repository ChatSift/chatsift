import type { Logger } from '@chatsift/backend-core';
import type { API, RESTPostAPIApplicationGuildCommandsJSONBody, Snowflake } from '@discordjs/core';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import type { ResyncFailure } from './resync.js';
import { describeError } from './resync.js';

/**
 * Tells `resyncGuildCommands` how to read and write one kind of command-backed row. ModMail snippets and
 * Social interactions are the same problem wearing different column names -- a guild-scoped row that owns a
 * Discord guild command, whose id stops resolving whenever the owning application changes (see `resync.ts`).
 */
export interface CommandResyncAdapter<TItem> {
	/**
	 * The Discord payload this item should be registered with. Must be byte-identical to the one its create
	 * route uses, or a resync would silently reissue a *different* command than the one it's repairing --
	 * which is why both domains keep theirs in a shared `discordBodies.ts`.
	 */
	buildBody(item: TItem): RESTPostAPIApplicationGuildCommandsJSONBody;
	/**
	 * Clears the stored command ids of the items about to be re-registered, before any new id is minted.
	 * Optional, and only meaningful where the column is nullable: Social needs it because
	 * `social_interactions` has a UNIQUE `(guild_id, command_id)` index and a bulk overwrite preserves a
	 * command's id by name -- so renaming one interaction and giving another its old name can hand a fresh id
	 * to a row while the stale row still holds it, which would collide mid-run. ModMail's
	 * `snippets.command_id` is NOT NULL and unconstrained, so it has nothing to clear.
	 */
	clearCommandIds?(items: TItem[]): Promise<void>;
	/**
	 * The item's currently stored command id, or `null` when it has none at all (a migrated row that has
	 * never been registered under any application this deployment owns). A `null` skips straight to
	 * registration -- there's nothing to check against Discord.
	 */
	commandId(item: TItem): string | null;
	/**
	 * How this item is named in a `ResyncFailure` and in logs, e.g. `snippet "welcome"`.
	 */
	describe(item: TItem): string;
	persistCommandId(item: TItem, commandId: string): Promise<void>;
}

export interface ResyncGuildCommandsOptions<TItem> {
	adapter: CommandResyncAdapter<TItem>;
	api: API;
	applicationId: string;
	guildId: Snowflake;
	items: TItem[];
	logger: Logger;
}

export interface ResyncGuildCommandsResult {
	/**
	 * Per-item failures that didn't stop the rest of the resync -- one bad row or command (a transient Discord
	 * error, a DB write that failed after a Discord call already succeeded) shouldn't block reconciling
	 * everything else for the guild. Empty on a fully clean run.
	 */
	failures: ResyncFailure[];
	/**
	 * Items whose command was (re-)registered and whose new id was persisted.
	 */
	recreated: number;
	staleCommandsDeleted: number;
}

/**
 * Reconciles a guild's Discord commands against the rows that own them: re-registers anything whose stored id
 * no longer resolves under `applicationId`, then deletes any guild command left over that no row claims.
 *
 * Deliberately per-item rather than a single `bulkOverwriteGuildCommands`: one row failing (a name Discord
 * has since reserved, a DB write that loses its connection) must not stop the rest of the guild from being
 * repaired, and a bulk overwrite is all-or-nothing. The trade-off is N+1 Discord calls, which is fine for an
 * explicitly-triggered maintenance action.
 *
 * The orphan-deletion pass at the end is only safe because every guild command belongs to the item set being
 * reconciled -- true for both current callers, whose bots keep their own commands (`/reply`, `/level`, ...)
 * global rather than guild-scoped. A future caller whose bot registers unrelated guild commands would need
 * that pass narrowed first.
 */
export async function resyncGuildCommands<TItem>({
	adapter,
	api,
	applicationId,
	guildId,
	items,
	logger,
}: ResyncGuildCommandsOptions<TItem>): Promise<ResyncGuildCommandsResult> {
	const failures: ResyncFailure[] = [];
	// Ids that must survive the cleanup pass below: every command a row still legitimately points at, plus
	// (see the inconclusive-failure branch) any whose status we couldn't actually establish.
	const liveCommandIds = new Set<string>();
	const needsRegistration: TItem[] = [];

	// Pass 1, read-only: which items still have a command that resolves under the current application? A
	// command id is only ever valid under the application that created it, so this doubles as the "does this
	// predate the last ownership change" test -- there's no need to track which application used to own the
	// guild.
	for (const item of items) {
		const commandId = adapter.commandId(item);
		if (!commandId) {
			needsRegistration.push(item);
			continue;
		}

		try {
			await api.applicationCommands.getGuildCommand(applicationId, guildId, commandId);
			liveCommandIds.add(commandId);
		} catch (error) {
			if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownApplicationCommand) {
				needsRegistration.push(item);
				continue;
			}

			// Inconclusive, not confirmed-stale -- a transient failure checking the command (rate limit, network
			// blip) tells us nothing about whether it's actually gone. Keep it in `liveCommandIds` so the cleanup
			// pass doesn't delete a command that may well still be fine just because this one check failed, then
			// surface the failure instead of guessing.
			liveCommandIds.add(commandId);
			logger.error({ err: error, guildId, item: adapter.describe(item) }, 'failed to check a guild command');
			failures.push({ item: adapter.describe(item), error: describeError(error) });
		}
	}

	// Pass 2: drop the stale ids before minting any replacement (see `clearCommandIds`). Not per-item
	// error-handled -- if the DB can't be written to at all, registering commands whose ids can't be stored
	// would just create orphans.
	if (needsRegistration.length > 0) {
		await adapter.clearCommandIds?.(needsRegistration);
	}

	// Pass 3: register replacements. Each item is handled in isolation -- one Discord hiccup, or a DB write
	// that fails after its Discord call already succeeded, shouldn't stop every other item in the guild.
	let recreated = 0;
	for (const item of needsRegistration) {
		try {
			const command = await api.applicationCommands.createGuildCommand(applicationId, guildId, adapter.buildBody(item));

			try {
				await adapter.persistCommandId(item, command.id);
			} catch (dbError) {
				// The command is live on Discord but the row doesn't point at it -- deliberately *not* added to
				// `liveCommandIds`, so the cleanup pass below deletes this brand-new command as an unrecognized
				// orphan (self-healing, if wasteful) and the next run recreates it. Logged with the orphaned
				// command's id so it can be found by hand sooner if needed.
				logger.error(
					{ err: dbError, guildId, item: adapter.describe(item), commandId: command.id },
					'created a replacement command but failed to persist its id',
				);
				failures.push({
					item: adapter.describe(item),
					error: `created replacement command ${command.id} but failed to save it: ${describeError(dbError)}`,
				});
				continue;
			}

			liveCommandIds.add(command.id);
			recreated++;
		} catch (error) {
			logger.error({ err: error, guildId, item: adapter.describe(item) }, 'failed to resync a guild command');
			failures.push({ item: adapter.describe(item), error: describeError(error) });
		}
	}

	// Pass 4: anything registered under the current application that isn't one of the guild's live items is an
	// orphan -- a leftover from a row since deleted, or (on a swap back to an application this guild used
	// before) from that earlier stint. This has to stay downstream of the passes above: `liveCommandIds` is
	// what makes it safe.
	const existingCommands = await api.applicationCommands.getGuildCommands(applicationId, guildId);
	let staleCommandsDeleted = 0;

	for (const command of existingCommands) {
		if (liveCommandIds.has(command.id)) {
			continue;
		}

		try {
			await api.applicationCommands.deleteGuildCommand(applicationId, guildId, command.id);
			staleCommandsDeleted++;
		} catch (error) {
			logger.error(
				{ err: error, guildId, commandId: command.id, commandName: command.name },
				'failed to delete stale guild command',
			);
			failures.push({ item: `command "${command.name}"`, error: describeError(error) });
		}
	}

	return { failures, recreated, staleCommandsDeleted };
}
