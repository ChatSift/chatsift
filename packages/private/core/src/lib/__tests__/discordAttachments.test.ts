import type { APIEmbed } from 'discord-api-types/v10';
import { expect, test } from 'vitest';
import { discordAttachmentFilename, resolveEditedImage, resolveEmbedsForEdit } from '../discordAttachments.js';

/**
 * Regression cover for a real Discord platform behavior rather than for our own logic: resending an
 * embed's *resolved* CDN url on a message **edit** makes Discord copy that url into the message's own
 * `attachments` array while still rendering the embed image, so the image shows up twice. Rewriting it to
 * `attachment://<filename>` first avoids that. Verified empirically with raw PATCH calls against the live
 * API -- these tests pin the rewrite so nobody "simplifies" it back out.
 */

const CDN = 'https://cdn.discordapp.com/attachments/1425493115053019319/1425493115053019320/screenshot.png';
const MEDIA = 'https://media.discordapp.net/attachments/1425493115053019319/1425493115053019320/screenshot.png';

// `services/api`'s attachment healing (#371) keys off the filename alone and has to be able to tell a
// recorded attachment's url apart from an arbitrary external one, so the `undefined` half is contractual.
test('the filename is extracted from an attachment url and only from one', () => {
	expect(discordAttachmentFilename(`${CDN}?ex=68b1&is=68b0&hm=deadbeef`)).toBe('screenshot.png');
	expect(discordAttachmentFilename(MEDIA)).toBe('screenshot.png');
	expect(discordAttachmentFilename('https://cdn.discordapp.com/attachments/1/2/my%20shot.png')).toBe('my shot.png');
	expect(discordAttachmentFilename('https://example.com/screenshot.png')).toBeUndefined();
	expect(discordAttachmentFilename('not a url')).toBeUndefined();
});

test('both Discord CDN hosts get rewritten to an attachment token', () => {
	expect(resolveEditedImage({ url: CDN })).toStrictEqual({ url: 'attachment://screenshot.png' });
	expect(resolveEditedImage({ url: MEDIA })).toStrictEqual({ url: 'attachment://screenshot.png' });
});

// `getMessage` always hands attachment urls back signed (`?ex=&is=&hm=`), so the query string is the
// normal case here, not an edge one.
test('the signed-url query string is dropped', () => {
	expect(resolveEditedImage({ url: `${CDN}?ex=68b1&is=68b0&hm=deadbeef&` })).toStrictEqual({
		url: 'attachment://screenshot.png',
	});
});

// Discord percent-encodes filenames in the url but expects the *decoded* name in the token.
test('a percent-encoded filename is decoded back', () => {
	const url = 'https://cdn.discordapp.com/attachments/1/2/my%20screen%20shot%20%2B1.png';

	expect(resolveEditedImage({ url })).toStrictEqual({ url: 'attachment://my screen shot +1.png' });
});

// A snippet's stored attachment url points at a completely different message, and an external image isn't
// ours at all -- neither is something Discord would duplicate, so both must pass through untouched.
test('anything that is not a Discord attachment url is left alone', () => {
	const external = { url: 'https://example.com/image.png' };
	expect(resolveEditedImage(external)).toBe(external);

	// Not the attachments route.
	const avatar = { url: 'https://cdn.discordapp.com/avatars/1/hash.png' };
	expect(resolveEditedImage(avatar)).toBe(avatar);

	// http, not https.
	const insecure = { url: 'http://cdn.discordapp.com/attachments/1/2/screenshot.png' };
	expect(resolveEditedImage(insecure)).toBe(insecure);
});

test('an imageless embed resolves to no image', () => {
	expect(resolveEditedImage(undefined)).toBeUndefined();
});

// A multi-attachment AMA question renders as a gallery of embeds, each carrying its own image -- every one
// of them needs the rewrite, not just the first.
test('every image across a gallery is rewritten', () => {
	const embeds: APIEmbed[] = [
		{ description: 'why?', image: { url: CDN } },
		{ image: { url: `${MEDIA}?ex=68b1` } },
		{ image: { url: 'https://example.com/external.png' } },
	];

	expect(resolveEmbedsForEdit(embeds)).toStrictEqual([
		{ description: 'why?', image: { url: 'attachment://screenshot.png' } },
		{ image: { url: 'attachment://screenshot.png' } },
		{ image: { url: 'https://example.com/external.png' } },
	]);
});

test('an embed with no image is passed through untouched', () => {
	const answerEmbed: APIEmbed = { description: 'because', footer: { text: 'Mod answered' } };

	expect(resolveEmbedsForEdit([answerEmbed])[0]).toBe(answerEmbed);
});
