import { createBrowserQueryClientAccessor } from '@chatsift/web-core/api/browserQueryClient';

/**
 * Hoisted out of `queryKeys` below so the accessor can be built from it without reading a `const` declared
 * further down the file. `queryKeys.me` is how this is spelled everywhere else -- same tuple, not a second
 * source of truth.
 */
const meQueryKey = ['api', 'me'] as const;

export const getBrowserQueryClient = createBrowserQueryClientAccessor(meQueryKey);

export const queryKeys = {
	all: ['api'] as const,
	me: meQueryKey,
	guild: (guildId: string) => ['api', 'guild', guildId] as const,
	invite: (code: string) => ['api', 'invite', code] as const,
	mine: ['api', 'mine'] as const,
};
