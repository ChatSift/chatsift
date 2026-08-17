import type { APIUser, DefaultUserAvatarAssets, Snowflake } from 'discord-api-types/v10';
import { CDNRoutes, ImageFormat, RouteBases } from 'discord-api-types/v10';
import { GenericAvatar } from './GenericAvatar';

interface DiscordUserAvatarProps {
	readonly className?: string;
	/**
	 * Fallback shown when there is no avatar asset to load at all. Callers pass whatever they call the account,
	 * since that differs by surface — a case or report prefers its stored `*_tag` snapshot over the resolved user.
	 */
	readonly initials: string;
	readonly user: APIUser | Snowflake;
}

/**
 * An account's avatar, given either a resolved user or just an id.
 *
 * A bare `Snowflake` is what the API's user-resolution helpers fall back to when Discord 404s the account
 * (`resolveDiscordUser`) — which is the common case on anything historical, since the subject of an old ban or
 * report has usually left. That is still enough to compute Discord's own id-derived default avatar; what's
 * missing is only the avatar hash, so there is no reason for a caller to special-case it.
 */
export function DiscordUserAvatar({ user, initials, className = 'h-6 w-6 rounded-full' }: DiscordUserAvatarProps) {
	const id = typeof user === 'string' ? user : user.id;
	const assetURL =
		typeof user === 'object' && user.avatar
			? `${RouteBases.cdn}${CDNRoutes.userAvatar(user.id, user.avatar, ImageFormat.PNG)}`
			: `${RouteBases.cdn}${CDNRoutes.defaultUserAvatar(Number((BigInt(id) >> 22n) % 6n) as DefaultUserAvatarAssets)}`;

	return <GenericAvatar assetURL={assetURL} className={className} disableLink initials={initials} isLoading={false} />;
}
