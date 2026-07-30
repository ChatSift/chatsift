import { getCustomInstanceGuildIds, getInstanceForGuild, getSelfInstance } from '@chatsift/backend-core';

const PUBLIC_LABEL = 'the public ModMail bot';

/**
 * The ownership rule from docs/roadmap/01-architecture.md §8: a guild with a
 * `modmail_instances` row belongs to that instance and no other; every other guild belongs to the
 * public deployment. Holds regardless of which bots are actually present in the guild -- the whole
 * point is to stay correct even if an admin left both the public and a custom bot in the same server.
 */
export function ownsGuild(guildId: string): boolean {
	const selfInstance = getSelfInstance();
	return selfInstance ? selfInstance.guildId === guildId : !getCustomInstanceGuildIds().has(guildId);
}

/**
 * Discriminated shape a sweep embeds into its own `WHERE` clause -- each sweep queries a different
 * table/alias for its guild id column, so this hands back the raw scoping data rather than a
 * ready-made SQL fragment. `'excluding'`'s list is commonly empty (no custom instances registered at
 * all), which `guild_id != ALL('{}')` -- vacuously true for every row -- handles without a branch.
 */
export type OwnershipScope =
	| { readonly excludedGuildIds: string[]; readonly kind: 'excluding' }
	| { readonly guildId: string; readonly kind: 'only' };

export function getOwnershipScope(): OwnershipScope {
	const selfInstance = getSelfInstance();
	if (selfInstance) {
		return { kind: 'only', guildId: selfInstance.guildId };
	}

	return { kind: 'excluding', excludedGuildIds: [...getCustomInstanceGuildIds()] };
}

/**
 * `null` if this deployment owns `guildId` (nothing to say); otherwise the label of whichever
 * deployment actually does, for the "this server is served by <label>" reply `@chatsift/bot-core`
 * sends instead of dispatching a leftover command/component to the wrong instance.
 */
export function resolveGuildOwnerLabel(guildId: string): string | null {
	if (ownsGuild(guildId)) {
		return null;
	}

	return getInstanceForGuild(guildId)?.label ?? PUBLIC_LABEL;
}
