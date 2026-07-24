import postgres from 'postgres';

export type Database = postgres.Sql;

// Generated row types (kanel — see docs/adr/0002-db-stack.md), re-exported from the package root so consumers can
// annotate `getContext().db<Row[]>` queries against the real schema instead of hand-duplicating row shapes. Add a
// table's types here the first time a consumer actually needs them — see docs/roadmap/02-foundation.md Part C.
export type { default as AmaPromptData, AmaPromptDataId } from './generated/public/AmaPromptData.js';
export type { default as AmaQuestions, AmaQuestionsId } from './generated/public/AmaQuestions.js';
export type { default as AmaQuestionState } from './generated/public/AmaQuestionState.js';
export type { default as AmaSessions, AmaSessionsId } from './generated/public/AmaSessions.js';
export type { default as DashboardGrants, DashboardGrantsId } from './generated/public/DashboardGrants.js';
export type { default as GuildSettings, GuildSettingsGuildId } from './generated/public/GuildSettings.js';
export type { default as Categories, CategoriesId } from './generated/public/Categories.js';
export type { default as TicketPanels, TicketPanelsId } from './generated/public/TicketPanels.js';
export type { default as TicketPanelCategories } from './generated/public/TicketPanelCategories.js';
export type { default as Threads, ThreadsId } from './generated/public/Threads.js';
export type { default as ThreadMessages, ThreadMessagesId } from './generated/public/ThreadMessages.js';
export type { default as ScheduledThreadCloses } from './generated/public/ScheduledThreadCloses.js';
export type { default as Blocks } from './generated/public/Blocks.js';
export type { default as ThreadOpenAlerts } from './generated/public/ThreadOpenAlerts.js';
export type { default as ThreadReplyAlerts } from './generated/public/ThreadReplyAlerts.js';
export type { default as Snippets, SnippetsId } from './generated/public/Snippets.js';
export type { default as SnippetUpdates, SnippetUpdatesId } from './generated/public/SnippetUpdates.js';

export interface CreateDbOptions {
	/**
	 * Passed through to `postgres()`, merged on top of the `postgres.camel` transform default
	 * (see docs/roadmap/02-foundation.md Part A step 2 for the snake_case + camel-transform decision).
	 */
	options?: postgres.Options<Record<string, postgres.PostgresType>>;
	url: string;
}

export function createDb({ url, options }: CreateDbOptions): Database {
	return postgres(url, { transform: postgres.camel, ...options });
}
