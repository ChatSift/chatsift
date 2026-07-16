/**
 * Raw SQL row shapes for `ama_sessions` / `ama_prompt_data` (packages/db/schema/schema.sql), matching what
 * `postgres.js`'s `postgres.camel` transform hands back at runtime. Kept local instead of importing the kanel
 * `AmaSessions`/`AmaPromptData` types from `@chatsift/db` — those carry branded id types and aren't re-exported
 * from the package root (see docs/adr/0002-db-stack.md's note on schema-level vs per-query typing).
 *
 * Lives under `util/`, not `routes/ama/`, so `services/api/src/index.ts`'s route-file glob loader doesn't sweep it
 * up and log a spurious "no default export" warning for it.
 */
export interface AMASessionRow {
	allowedQuestionUploads: number;
	answersChannelId: string;
	createdAt: Date;
	ended: boolean;
	flaggedQueueId: string | null;
	guestQueueId: string | null;
	guildId: string;
	id: number;
	modQueueId: string | null;
	promptChannelId: string;
	title: string;
}

export interface AMAPromptDataRow {
	amaId: number;
	id: number;
	promptJsonData: string;
	promptMessageId: string;
}
