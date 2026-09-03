import type { APIEmbed, APIEmbedImage } from 'discord-api-types/v10';

/**
 * Matches a Discord CDN attachment url (`cdn.discordapp.com`/`media.discordapp.net`), capturing the
 * filename -- the one piece `attachment://<filename>` needs (see `resolveEditedImage` below).
 */
const DISCORD_ATTACHMENT_URL_PATTERN =
	/^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\/\d+\/\d+\/(?<filename>[^/?]+)/;

/**
 * Pulls the (percent-decoded) filename back out of a Discord CDN attachment url, or `undefined` for
 * anything that isn't one -- an external image, a relative path, garbage. The filename is the one part of
 * an attachment url that's stable across refetches (the signature isn't), so it's what both callers key on:
 * `resolveEditedImage` below to rebuild the `attachment://` token, and `services/api`'s
 * `routes/modmail/threads/util.ts` to work out which recorded attachment an embed's image actually is.
 */
export function discordAttachmentFilename(url: string): string | undefined {
	const match = DISCORD_ATTACHMENT_URL_PATTERN.exec(url);
	return match ? decodeURIComponent(match.groups!['filename']!) : undefined;
}

/**
 * Rewrites an embed image's url from the *resolved* form `getMessage` always hands back into the
 * `attachment://<filename>` token form instead, before it's resent on an edit. Verified empirically
 * (manual `PATCH` calls against the live API, bypassing discord.js entirely) that resending the resolved
 * CDN url as-is on an edit makes Discord silently copy that url into the message's own `attachments`
 * array while *also* still rendering the embed's image -- i.e. the image shows twice, once merged in
 * the embed and once as its own separate block. Resending it as `attachment://<filename>` instead avoids
 * that entirely: Discord resolves it back to the correct working image with no separate attachment
 * entry, confirmed on both an already-duplicated message (recovers) and a never-before-edited one (never
 * duplicates in the first place). This works regardless of whether the image genuinely belongs to this
 * message or was only ever a fixed external reference (e.g. a snippet's stored attachment url, which
 * points at a completely different message) -- Discord resolves the token by filename either way.
 * Left untouched for anything that isn't a Discord CDN attachment url in the first place.
 *
 * Lives in `@chatsift/core` rather than next to its first caller (`services/modmail-bot`'s
 * `replyModeration.ts`) because the AMA side hit the exact same behavior once #328 let a merge re-render
 * an already-posted, image-bearing question -- see `resolveEmbedsForEdit`.
 */
export function resolveEditedImage(image: APIEmbedImage | undefined): APIEmbedImage | undefined {
	if (!image) {
		return undefined;
	}

	const filename = discordAttachmentFilename(image.url);
	if (!filename) {
		return image;
	}

	return { url: `attachment://${filename}` };
}

/**
 * Applies {@link resolveEditedImage} across a whole set of embeds about to be sent on a message *edit*
 * -- which for AMA means every embed, since a multi-attachment question renders as a gallery of them
 * (see `getBaseEmbeds`) and each one carries its own image.
 *
 * Only correct on an edit: on the initial post there's no existing attachment for Discord to duplicate,
 * and the resolved url is what actually gets the image onto the message in the first place.
 */
export function resolveEmbedsForEdit(embeds: APIEmbed[]): APIEmbed[] {
	return embeds.map((embed) => {
		const image = resolveEditedImage(embed.image);
		return image ? { ...embed, image } : embed;
	});
}
