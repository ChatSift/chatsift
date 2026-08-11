/**
 * Shared vocabulary for the resync routes -- the operations that reconcile Discord-side state a guild's rows
 * point at (snippet/interaction guild commands, ticket panel messages) back against the DB.
 *
 * Resync exists because everything Discord scopes to an *application* is orphaned when the application that
 * owns a guild changes: a guild moving between ModMail's public deployment and a custom instance (#216,
 * docs/roadmap/01-architecture.md §8), or between a bot's production deployment and its canary. A command id
 * minted by one application simply doesn't resolve under another, and the new owner inherits nothing. Migrated
 * data lands in the same state by construction (see `social_interactions.command_id`, written NULL by the
 * legacy migration), as does anything deleted out of band or half-written by a failed mutation.
 *
 * `commandResync.ts` implements the guild-command half of that, shared by ModMail's snippets and Social's
 * interactions; panels have their own message-reposting flow but report failures the same way.
 */

export interface ResyncFailure {
	error: string;
	/**
	 * Human-readable identifier for whichever snippet/interaction/command/panel this failure is about --
	 * there's no single shared id space across the kinds of item resync touches, so this is just enough to
	 * find it (a name for a command-backed row, a numeric id for a panel) rather than a structured reference.
	 */
	item: string;
}

export function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
