import { SnowflakeRegex } from '@sapphire/discord-utilities';
import z from 'zod';

export const snowflakeSchema = z.string().regex(SnowflakeRegex);

/**
 * A user-supplied URL that ends up as a Discord embed's `image.url` -- a modmail snippet's or ticket panel's
 * `attachmentUrl`, a social interaction's. Discord's own servers fetch/proxy that URL when rendering the embed
 * and the bot process never connects to it, so this just needs to rule out non-http(s) schemes
 * (`javascript:`, `data:`, ...); there's no SSRF against our own infrastructure to defend against here.
 *
 * Lives here rather than in either domain's `schemas.ts` because both need the identical rule -- and this
 * module is already the browser-safe one both of those import (they're re-exported to `apps/website`, see
 * their file-level comments).
 */
// The check must stay on the global WHATWG `URL` -- `node:url`'s doesn't exist in a browser bundle.
/* eslint-disable n/prefer-global/url */
function isHttpUrl(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	/* eslint-enable n/prefer-global/url */

	return url.protocol === 'http:' || url.protocol === 'https:';
}

export const httpUrlSchema = z.url().max(2_000).refine(isHttpUrl, 'Attachment URL must use http(s)');

export const queryWithFreshSchema = z.strictObject({
	force_fresh: z.stringbool().optional().default(false),
});

/**
 * First paginated route shape in the codebase (`modmail/threads/{listThreads,getThread}.ts`, #261) --
 * cursor-based (an opaque, monotonically-decreasing id to page backwards from) rather than
 * offset/limit, since every paginated list here orders by a `GENERATED ... AS IDENTITY` primary key and
 * an offset would drift under concurrent inserts (new tickets/messages arriving while staff scroll).
 */
export function createPaginationQuerySchema(defaultLimit: number, maxLimit: number) {
	return z.object({
		cursor: z.coerce.number().int().positive().optional(),
		limit: z.coerce.number().int().positive().max(maxLimit).optional().default(defaultLimit),
	});
}
