import { getInstanceForGuild, RedisStore, type Instance } from '@chatsift/backend-core';
import { createRecipe, DataType } from 'bin-rw';
import { apiForGuild } from './discordAPI.js';

const applicationIdByInstance = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

/**
 * A ModMail bot's own Discord application id -- required as the first argument to every guild
 * slash-command call (create/edit/delete). Not exposed via env; an application's id never changes, so it's
 * fetched once per bot token (public, or a given custom instance) and cached for the life of the process.
 *
 * Keyed off `guildId` rather than a bot token directly -- `'public'` for a guild with no `modmail_instances`
 * row, otherwise the owning instance's id -- mirroring `discordAPI.ts#resolveGuildAPI`'s cache-key
 * dimension, since a partner's bot application is a different id from the public one.
 */
export async function getModmailApplicationId(guildId: string): Promise<string> {
	const key = getInstanceForGuild(guildId)?.id ?? 'public';

	const cached = applicationIdByInstance.get(key);
	if (cached) {
		return cached;
	}

	let inflight = pending.get(key);
	if (!inflight) {
		inflight = (async () => {
			try {
				const application = await apiForGuild('MODMAIL', guildId).applications.getCurrent();
				applicationIdByInstance.set(key, application.id);
				return application.id;
			} catch (error) {
				// A transient failure (network blip, momentary Discord outage) shouldn't poison every future call for
				// the rest of the process's lifetime -- clear the cached promise so the next call retries fresh.
				pending.delete(key);
				throw error;
			}
		})();

		pending.set(key, inflight);
	}

	return inflight;
}

export interface InstanceBranding {
	iconUrl: string | null;
	label: string;
}

function iconUrl(applicationId: string, iconHash: string | null): string | null {
	return iconHash ? `https://cdn.discordapp.com/app-icons/${applicationId}/${iconHash}.png` : null;
}

// `/me` (which this feeds, see `me.ts`) is hit on effectively every dashboard page load and is already slow
// from its own Discord calls -- branding must never add to that critical path. An app icon changes on the
// order of "a partner rebrands", not per-request, so this is cached about as aggressively as a value can be:
// a long-lived in-process `Map` (no per-request redis round trip once warm) refreshed lazily in the
// background well after it goes stale, never blocking the caller on a fresh fetch. Redis is only a fallback
// for a cold process (a fresh replica, or one that just restarted) so it doesn't have to hit Discord itself.
const BRANDING_TTL_MS = 24 * 60 * 60 * 1_000; // 24 hours
// On a fetch failure, back off for a short while before the next background retry rather than hammering
// Discord (or a dead/revoked partner token) on every subsequent `/me` for the rest of the TTL window.
const BRANDING_RETRY_BACKOFF_MS = 5 * 60 * 1_000; // 5 minutes

interface BrandingCacheEntry {
	branding: InstanceBranding;
	expiresAt: number;
}

const brandingCache = new Map<string, BrandingCacheEntry>();
const brandingRefreshInFlight = new Set<string>();
// De-dupes concurrent cold-start callers (both `brandingCache` and `brandingStore` empty for this instance)
// onto a single in-flight lookup -- mirrors `getModmailApplicationId`'s `pending` map above. Without this, a
// burst of `/me` requests landing before the very first fetch for a given instance resolves would each kick
// off their own redis read + potential Discord call instead of sharing one.
const brandingPending = new Map<string, Promise<InstanceBranding>>();

const brandingStore = new RedisStore<{ iconUrl: string | null }>({
	TTL: BRANDING_TTL_MS,
	recipe: createRecipe({ iconUrl: DataType.String }, { versioned: true }),
	makeKey: (instanceId: string) => `modmail:instance-branding:${instanceId}`,
	storeOld: false,
});

async function fetchBrandingFromDiscord(instance: Instance): Promise<InstanceBranding> {
	const application = await apiForGuild('MODMAIL', instance.guildId).applications.getCurrent();
	const branding: InstanceBranding = {
		iconUrl: iconUrl(application.id, application.icon ?? null),
		label: instance.label,
	};

	await brandingStore.set(instance.id, { iconUrl: branding.iconUrl });
	return branding;
}

/**
 * Fire-and-forget refresh for an already-warm (but stale) in-memory entry -- the caller that triggered this
 * already got its answer from the stale value, so a Discord failure here must never surface to a request;
 * it just extends the backoff and leaves the previous value in place for the next caller to keep serving.
 */
function refreshInBackground(instance: Instance): void {
	if (brandingRefreshInFlight.has(instance.id)) {
		return;
	}

	brandingRefreshInFlight.add(instance.id);
	void (async () => {
		try {
			const branding = await fetchBrandingFromDiscord(instance);
			brandingCache.set(instance.id, { branding, expiresAt: Date.now() + BRANDING_TTL_MS });
		} catch {
			const existing = brandingCache.get(instance.id);
			brandingCache.set(instance.id, {
				branding: existing?.branding ?? { iconUrl: null, label: instance.label },
				expiresAt: Date.now() + BRANDING_RETRY_BACKOFF_MS,
			});
		} finally {
			brandingRefreshInFlight.delete(instance.id);
		}
	})();
}

/**
 * A custom instance's avatar/label for the dashboard's branding (#216 P2/P3) -- `label` is just
 * `instance.label` (already in the registry row), but the icon needs its own Discord call
 * (`applications.getCurrent()` on the instance's own token), since the registry only stores the bot token,
 * not its profile. See the cache-layering comment above `BRANDING_TTL_MS` -- this only ever does a
 * synchronous Discord call for the very first request a process ever sees for a given instance (and redis
 * is empty too); every other call, warm or stale, returns from memory immediately.
 */
export async function getInstanceBranding(instance: Instance): Promise<InstanceBranding> {
	const cached = brandingCache.get(instance.id);
	if (cached) {
		if (Date.now() >= cached.expiresAt) {
			refreshInBackground(instance);
		}

		return cached.branding;
	}

	let inflight = brandingPending.get(instance.id);
	if (!inflight) {
		inflight = (async () => {
			try {
				const redisCached = await brandingStore.get(instance.id);
				const branding: InstanceBranding = redisCached
					? { iconUrl: redisCached.iconUrl, label: instance.label }
					: await fetchBrandingFromDiscord(instance);

				brandingCache.set(instance.id, { branding, expiresAt: Date.now() + BRANDING_TTL_MS });
				return branding;
			} finally {
				brandingPending.delete(instance.id);
			}
		})();

		brandingPending.set(instance.id, inflight);
	}

	return inflight;
}
