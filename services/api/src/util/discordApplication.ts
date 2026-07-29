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

// An app icon can change (unlike its id above), so this goes through redis with a TTL rather than living
// forever in-process -- but still cached, rather than fetched fresh, since `/me` (which this feeds, see
// `me.ts`) is hit on effectively every dashboard page load.
const BRANDING_CACHE_TTL_MS = 60 * 60 * 1_000; // 1 hour

const brandingStore = new RedisStore<{ iconHash: string | null }>({
	TTL: BRANDING_CACHE_TTL_MS,
	recipe: createRecipe({ iconHash: DataType.String }),
	makeKey: (instanceId: string) => `modmail:instance-branding:${instanceId}`,
	storeOld: false,
});

function iconUrl(applicationId: string, iconHash: string | null): string | null {
	return iconHash ? `https://cdn.discordapp.com/app-icons/${applicationId}/${iconHash}.png` : null;
}

/**
 * A custom instance's avatar/label for the dashboard's branding (#216 P2/P3) -- `label` is just
 * `instance.label` (already in the registry row), but the icon needs its own Discord call
 * (`applications.getCurrent()` on the instance's own token), since the registry only stores the bot token,
 * not its profile.
 */
export async function getInstanceBranding(instance: Instance): Promise<InstanceBranding> {
	const cached = await brandingStore.get(instance.id);
	if (cached) {
		const applicationId = await getModmailApplicationId(instance.guildId);
		return { iconUrl: iconUrl(applicationId, cached.iconHash), label: instance.label };
	}

	const application = await apiForGuild('MODMAIL', instance.guildId).applications.getCurrent();
	await brandingStore.set(instance.id, { iconHash: application.icon ?? null });

	return { iconUrl: iconUrl(application.id, application.icon ?? null), label: instance.label };
}
