import type { DefaultUserAvatarAssets } from 'discord-api-types/v10';
import { CDNRoutes, ImageFormat, RouteBases } from 'discord-api-types/v10';

/**
 * Discord CDN urls, so the `RouteBases.cdn + CDNRoutes.*` expression lives in one place. Three copies of it had
 * already accumulated (`amaEmbeds.ts`, `services/automoderator-bot`'s `guildLogFormat.ts`, `services/api`'s
 * `util/users.ts`) before #377 wanted a fourth.
 */

/**
 * A user's own avatar, or `null` when they have never set one.
 */
export function userAvatarURL(userId: string, avatar: string | null | undefined): string | null {
	return avatar ? `${RouteBases.cdn}${CDNRoutes.userAvatar(userId, avatar, ImageFormat.PNG)}` : null;
}

/**
 * The default avatar Discord's own client draws for an account with none of its own.
 *
 * Indexed off the id, which is the post-pomelo rule. Legacy discriminator-bearing accounts index by
 * `discriminator % 5` instead; that is deliberately not handled, because the accounts this renders for are case
 * and report subjects being drawn *today*, and what Discord shows today is the modern index.
 */
function defaultUserAvatarURL(userId: string): string {
	// An id that isn't digits throws out of `BigInt`, and this is called from inside embed builders -- a log
	// entry is not worth losing over the picture on it. Nothing that reaches here should be non-numeric anyway.
	let index: DefaultUserAvatarAssets = 0;

	try {
		index = Number((BigInt(userId) >> 22n) % 6n) as DefaultUserAvatarAssets;
	} catch {
		index = 0;
	}

	return `${RouteBases.cdn}${CDNRoutes.defaultUserAvatar(index)}`;
}

/**
 * The avatar to actually *show* for a user: their own when they have one, Discord's default otherwise.
 *
 * Embeds use this rather than {@link userAvatarURL} so an author line is never half-illustrated -- a guild
 * where some members never set an avatar would otherwise render two visibly different embed shapes for the same
 * kind of event (#377).
 */
export function displayAvatarURL(userId: string, avatar: string | null | undefined): string {
	return userAvatarURL(userId, avatar) ?? defaultUserAvatarURL(userId);
}

/**
 * A guild's icon, or `null` when it has none.
 */
export function guildIconURL(guildId: string, icon: string | null | undefined): string | null {
	return icon ? `${RouteBases.cdn}${CDNRoutes.guildIcon(guildId, icon, ImageFormat.PNG)}` : null;
}

/**
 * A guild's banner at a size worth putting in an embed, or `null` when it has none.
 */
export function guildBannerURL(guildId: string, banner: string | null | undefined): string | null {
	return banner ? `${RouteBases.cdn}${CDNRoutes.guildBanner(guildId, banner, ImageFormat.PNG)}?size=1024` : null;
}
