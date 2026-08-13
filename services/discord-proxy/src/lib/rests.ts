import { Buffer } from 'node:buffer';
import { REST, RESTEvents } from '@discordjs/rest';
import type { Logger } from 'pino';

/**
 * Every request that isn't authorized by a bot token shares this one key.
 *
 * Two kinds of traffic land here, and both are correct to pool:
 *  - requests with no `Authorization` at all (interaction callbacks, webhook execution) -- Discord buckets
 *    those by the id/token in the URL itself, which `REST` already derives as the major parameter, so there's
 *    no per-caller state to keep apart;
 *  - `Bearer` requests, which must *never* get a REST instance each. Those tokens are per end user, so keying
 *    on them would grow the map without bound -- one entry per dashboard visitor, forever. `services/api`
 *    deliberately keeps its OAuth client pointed straight at Discord for this reason (see `discordAPI.ts`);
 *    this is the safety net for anything that slips through.
 *
 * Pooling does mean these callers share one `globalRequestsPerSecond` budget, which is left at the default 50
 * rather than the `Infinity` the clients use. That's deliberate and costs nothing today: Discord's 50/s global
 * limit is per bot token and doesn't apply to token-less routes at all, so this is a self-imposed backstop
 * against runaway volume rather than a mirror of anything upstream. It notably cannot delay an interaction
 * callback -- `@discordjs/rest` routes `/interactions/:id/:token/callback` to a `BurstHandler`, which neither
 * reads nor decrements the global counter (only `SequentialHandler` does), so the 3s ack window is never at
 * this budget's mercy. Webhook execution is the only pooled traffic it can actually throttle.
 */
const POOLED_KEY = '';

/**
 * Bot tokens are the only thing worth isolating: Discord's rate limits -- both the per-route buckets and the
 * 50-requests-per-second global allowance -- are scoped to the token.
 */
export function resolveRestKey(authorization: string | undefined): string {
	return authorization?.startsWith('Bot ') ? authorization : POOLED_KEY;
}

/**
 * A log-safe name for a key. The first dot-delimited segment of a bot token is the base64 application id --
 * public information, unlike the rest of the token, and enough to tell which bot a rate limit belongs to.
 */
export function describeRestKey(key: string): string {
	if (key === POOLED_KEY) {
		return 'pooled';
	}

	const [encodedApplicationId] = key.slice('Bot '.length).split('.');
	const applicationId = Buffer.from(encodedApplicationId ?? '', 'base64').toString('utf8');

	return /^\d{17,20}$/.test(applicationId) ? applicationId : 'unknown';
}

/**
 * One `REST` per token, rather than one shared `REST` with per-request `auth`.
 *
 * This is the difference between this service and upstream's `apps/proxy-container`, whose README tells you
 * not to point multiple bots at one container. It hands every request to a single `REST` with `auth: false`,
 * and that instance keys its handlers on `${bucketHash}:${majorParameter}` while tracking `globalRemaining`
 * per REST instance rather than per token -- so N tokens share one 50/s allowance and collide on hashes.
 * Giving each token its own instance restores both, and is what lets one process stand in for the N proxy
 * containers the old stack would have needed (one per bot, plus one per custom ModMail instance, which are
 * added by partner onboarding at runtime -- see docs/roadmap/01-architecture.md §8).
 */
function createProxyRest(key: string, logger: Logger): REST {
	const rest = new REST({
		version: '10',
		// The two options that make this a fail-fast proxy rather than a queueing one: a rate limit is reported
		// to the caller as a 429 instead of being absorbed here as latency. Callers keep control over their own
		// retry policy (`@discordjs/rest` retries 429s transparently by default, and per-request
		// `rejectOnRateLimit` lets individual call sites opt out) -- which they'd lose entirely if we silently
		// waited on their behalf. It also means we never hold a socket open waiting out someone else's bucket.
		rejectOnRateLimit: () => true,
		retries: 0,
		// Discord's Cloudflare layer bans an IP that racks up ~10k invalid (401/403/429) responses in 10
		// minutes. This process is the only one that knows what actually reached Discord -- our clients now
		// count our synthesized 429s, which never left the network -- so this is where the counter has to live.
		invalidRequestWarningInterval: 250,
	});

	const bot = describeRestKey(key);

	rest.on(RESTEvents.RateLimited, (rateLimitInfo) => {
		logger.warn({ bot, ...rateLimitInfo }, 'Hit a Discord REST rate limit');
	});

	rest.on(RESTEvents.InvalidRequestWarning, (warning) => {
		logger.warn({ bot, ...warning }, 'Invalid request count climbing -- Cloudflare ban risk');
	});

	return rest;
}

export interface RestCache {
	forAuthorization(authorization: string | undefined): REST;
	/**
	 * Number of live `REST` instances. Bounded by the number of distinct bot tokens in the deployment, since
	 * everything else pools onto one.
	 */
	readonly size: number;
}

export function createRestCache(logger: Logger): RestCache {
	const rests = new Map<string, REST>();

	return {
		get size() {
			return rests.size;
		},
		forAuthorization(authorization) {
			const key = resolveRestKey(authorization);

			let rest = rests.get(key);
			if (!rest) {
				rest = createProxyRest(key, logger);
				rests.set(key, rest);
				logger.info({ bot: describeRestKey(key), tokens: rests.size }, 'Tracking rate limits for a new token');
			}

			return rest;
		},
	};
}
