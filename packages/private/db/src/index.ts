import { performance } from 'node:perf_hooks';
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
export type { default as PendingTickets, PendingTicketsPrivateThreadId } from './generated/public/PendingTickets.js';
export type { default as Threads, ThreadsId } from './generated/public/Threads.js';
export type { default as ThreadMessages, ThreadMessagesId } from './generated/public/ThreadMessages.js';
export type { default as ThreadMessageContent } from './generated/public/ThreadMessageContent.js';
export type {
	default as ThreadMessageContentEdits,
	ThreadMessageContentEditsId,
} from './generated/public/ThreadMessageContentEdits.js';
export type { default as ScheduledThreadCloses } from './generated/public/ScheduledThreadCloses.js';
export type { default as ScheduledThreadNukes } from './generated/public/ScheduledThreadNukes.js';
export type { default as Blocks } from './generated/public/Blocks.js';
export type { default as ThreadOpenAlerts } from './generated/public/ThreadOpenAlerts.js';
export type { default as ThreadReplyAlerts } from './generated/public/ThreadReplyAlerts.js';
export type { default as Snippets, SnippetsId } from './generated/public/Snippets.js';
export type { default as SnippetUpdates, SnippetUpdatesId } from './generated/public/SnippetUpdates.js';

export interface SlowQueryLogOptions {
	/**
	 * Minimal structural subset of a pino Logger -- kept structural rather than a real pino import so
	 * this package doesn't need pino as a dependency; any pino instance already satisfies this shape.
	 */
	logger: {
		warn(obj: Record<string, unknown>, msg?: string): void;
	};
	/**
	 * Queries at or above this duration are logged via `logger.warn`.
	 */
	thresholdMs: number;
}

export interface CreateDbOptions {
	/**
	 * Passed through to `postgres()`, merged on top of the `postgres.camel` transform default
	 * (see docs/roadmap/02-foundation.md Part A step 2 for the snake_case + camel-transform decision).
	 */
	options?: postgres.Options<Record<string, postgres.PostgresType>>;
	/**
	 * When set, every query executed through the returned client (including inside `.begin()`/
	 * `.savepoint()` callbacks) is timed and slow ones are logged -- the app-level complement to the
	 * Postgres-side `pg_stat_statements` setup (see docker-compose.yml, build/postgres/init) added in
	 * #270. Unlike that DB-wide view, this one carries per-service context (whichever logger the caller
	 * passed in) at effectively no cost: no new dependency, no restart, no extension.
	 */
	slowQuery?: SlowQueryLogOptions;
	url: string;
}

export function createDb({ url, options, slowQuery }: CreateDbOptions): Database {
	const sql = postgres(url, { transform: postgres.camel, ...options });
	return slowQuery ? instrumentSlowQueries(sql, slowQuery) : sql;
}

function isTemplateStringsArray(value: unknown): value is TemplateStringsArray {
	return Array.isArray(value) && 'raw' in value;
}

/**
 * Wraps every query issued through `sql` with a non-consuming `.finally()` timer -- the original
 * `Promise`-like query object returned by postgres.js is handed back to the caller completely untouched,
 * so every chain method (`.raw()`, `.cursor()`, `.simple()`, ...) keeps working exactly as before. Only
 * real tagged-template invocations are timed (detected via the `TemplateStringsArray`'s `.raw` property)
 * -- postgres.js's "helper" call form (e.g. `sql(values, 'col1', 'col2')` for building a fragment) returns
 * a non-promise `Helper` object and is passed through untouched. `.begin()`/`.savepoint()` recurse so
 * transaction queries are covered too, since postgres.js hands the callback a distinct `sql`-like function
 * that this outer proxy never otherwise sees.
 */
function instrumentSlowQueries<TSql extends object>(sql: TSql, slowQuery: SlowQueryLogOptions): TSql {
	const { logger, thresholdMs } = slowQuery;

	const timeQuery = (promise: Promise<unknown>, queryText: string): void => {
		const start = performance.now();
		// Deliberately not awaited: this attaches a non-consuming observer to the query's own promise
		// and returns immediately, so the caller's `await sql\`...\`` is never delayed or altered.
		// eslint-disable-next-line promise/prefer-await-to-then -- see above, can't `await` here without blocking the caller
		void promise.finally(() => {
			const elapsedMs = performance.now() - start;
			if (elapsedMs >= thresholdMs) {
				logger.warn({ elapsedMs: Math.round(elapsedMs), query: queryText }, 'slow query');
			}
		});
	};

	return new Proxy(sql, {
		apply(target, thisArg, argArray: unknown[]): unknown {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- `sql` is always callable at runtime
			const result: unknown = Reflect.apply(target as Function, thisArg, argArray);
			const [first] = argArray;
			if (isTemplateStringsArray(first) && result instanceof Promise) {
				timeQuery(result, first.join('?'));
			}

			return result;
		},
		get(target, prop, receiver): unknown {
			if (prop === 'begin' || prop === 'savepoint') {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- both are always callable at runtime
				const original = Reflect.get(target, prop, receiver) as Function;
				return (...beginArgs: unknown[]) => {
					const lastIndex = beginArgs.length - 1;
					const fn = beginArgs[lastIndex] as (tx: object) => unknown;
					const wrappedArgs = [...beginArgs];
					wrappedArgs[lastIndex] = (tx: object) => fn(instrumentSlowQueries(tx, slowQuery));
					return Reflect.apply(original, target, wrappedArgs);
				};
			}

			return Reflect.get(target, prop, receiver);
		},
	});
}
