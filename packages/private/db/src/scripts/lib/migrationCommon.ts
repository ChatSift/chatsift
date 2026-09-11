// The half of a legacy-migration script that has nothing to do with which product is being migrated:
// transaction plumbing, batching, the read/inserted/skipped tally, and resolving the two database URLs.
//
// Extracted when the AutoModerator migration (#11 P9) became the third of these -- `migrateLegacyModmail.ts`
// and `migrateLegacySocial.ts` are the first two, and a third copy of `RollbackSignal`/`chunk`/`statFor` was
// the point at which they stopped being incidental repetition. Everything here is deliberately
// product-agnostic; a helper that knows a table name belongs in that product's own `legacy*.ts`.

import { Buffer } from 'node:buffer';
import process from 'node:process';
import type postgres from 'postgres';

/**
 * The common supertype of the top-level client (`Database`) and a `sql.begin` transaction handle --
 * everything in these scripts only ever queries and builds fragments, so they accept either rather than
 * forcing every helper to know which one it was handed.
 */
export type Executor = postgres.ISql;

// Big enough that the round-trip count stays trivial, small enough that a single INSERT's parameter list
// stays well clear of Postgres' 65535-parameter ceiling (the widest table any of these scripts binds is
// around 15 columns per row).
export const BATCH_SIZE = 1_000;

/**
 * Thrown to unwind out of `sql.begin` once a `--dry-run` has finished, so postgres.js issues a ROLLBACK
 * instead of a COMMIT. Caught and swallowed by the caller -- it is not a failure.
 */
export class RollbackSignal extends Error {
	public constructor() {
		super('dry run complete, rolling back');
		this.name = 'RollbackSignal';
	}
}

export interface TableStat {
	inserted: number;
	read: number;
	skipped: number;
}

export type Stats = Record<string, TableStat>;

export function statFor(read: number, inserted: number): TableStat {
	return { read, inserted, skipped: read - inserted };
}

export function chunk<TItem>(items: readonly TItem[], size: number): TItem[][] {
	const out: TItem[][] = [];
	for (let index = 0; index < items.length; index += size) {
		out.push(items.slice(index, index + size));
	}

	return out;
}

export function printStats(stats: Stats): void {
	console.log('\nTable                              read  inserted  skipped');
	for (const [table, stat] of Object.entries(stats)) {
		console.log(
			`  ${table.padEnd(33)}${String(stat.read).padStart(4)}${String(stat.inserted).padStart(10)}${String(stat.skipped).padStart(9)}`,
		);
	}
}

// Destructured rather than accessed key-by-key: `ProcessEnv` is an index signature, so
// `noPropertyAccessFromIndexSignature` rejects dot access while eslint's `dot-notation` rejects bracket
// access. Destructuring is the one form both are happy with.
const { IS_PRODUCTION, DATABASE_URL_DEV, DATABASE_URL_PROD, LEGACY_DATABASE_URL, ENCRYPTION_KEY } = process.env;

// The exact sets `zod`'s `stringbool()` uses, which is what parses IS_PRODUCTION in
// `@chatsift/backend-core`'s shared env schema. Duplicated rather than imported because these scripts
// deliberately don't pull in backend-core (that schema is a top-level `.parse(process.env)` evaluated on
// import by every service, so adding LEGACY_DATABASE_URL to it would break all of them for the sake of a
// script none of them run) -- but it has to agree with it *exactly*: a script picking a different database
// than the rest of the stack, while `--live` commits real inserts, is the worst way for it to be wrong.
const TRUTHY = new Set(['true', '1', 'yes', 'on', 'y', 'enabled']);
const FALSY = new Set(['false', '0', 'no', 'off', 'n', 'disabled']);

export function resolveTargetUrl(): string {
	// `envSchema` declares IS_PRODUCTION as `.default(false)`, so unset means dev -- but an unrecognized
	// value is an error there, not a silent falsy. Match that: quietly treating `IS_PRODUCTION=maybe` as dev
	// would point a `--live` run at DATABASE_URL_DEV while the rest of the stack ran on prod config.
	const raw = (IS_PRODUCTION ?? 'false').toLowerCase();
	if (!TRUTHY.has(raw) && !FALSY.has(raw)) {
		console.error(
			`IS_PRODUCTION is set to ${JSON.stringify(IS_PRODUCTION)}, which is not a recognized boolean — expected one ` +
				`of ${[...TRUTHY, ...FALSY].join(', ')}. Refusing to guess which database to target.`,
		);
		process.exit(1);
	}

	const isProduction = TRUTHY.has(raw);
	const url = isProduction ? DATABASE_URL_PROD : DATABASE_URL_DEV;

	if (!url) {
		console.error(`${isProduction ? 'DATABASE_URL_PROD' : 'DATABASE_URL_DEV'} is not set`);
		process.exit(1);
	}

	return url;
}

export function resolveLegacyUrl(product: string): string {
	if (!LEGACY_DATABASE_URL) {
		console.error(
			`LEGACY_DATABASE_URL is required — point it at a restored copy of the ${product} database, never the ` +
				'live one (these scripts hold one transaction open across reads of the legacy side)',
		);
		process.exit(1);
	}

	return LEGACY_DATABASE_URL;
}

/**
 * The same `ENCRYPTION_KEY` every service reads, for the one migrated column that is encrypted at rest
 * (`automoderator_log_webhooks.webhook_token`). Validated here rather than left to `createCipheriv` to
 * reject, because the useful moment to find out the key is missing or the wrong length is before a
 * migration has written half a database, not partway through the one table that needs it.
 */
export function resolveEncryptionKey(): string {
	if (!ENCRYPTION_KEY) {
		console.error(
			'ENCRYPTION_KEY is required — webhook tokens are encrypted at rest, and a migration run without it would ' +
				'either abort partway or write tokens the API cannot decrypt',
		);
		process.exit(1);
	}

	// AES-256 wants exactly 32 bytes. A key of the wrong length fails at `createCipheriv`, which would happen
	// per-row and mid-transaction; checking the decoded length up front turns that into one clear line.
	const decodedLength = Buffer.from(ENCRYPTION_KEY, 'base64').length;
	if (decodedLength !== 32) {
		console.error(`ENCRYPTION_KEY decodes to ${decodedLength} bytes, expected 32 (base64-encoded AES-256 key)`);
		process.exit(1);
	}

	return ENCRYPTION_KEY;
}

/**
 * Snowflake shape, used to validate guild ids taken from the command line. Deliberately not a range check --
 * anything that is a run of digits is a plausible id, and the real safety comes from `--dry-run` showing
 * exactly what would be written.
 */
export const SNOWFLAKE_PATTERN = /^\d{17,20}$/u;
