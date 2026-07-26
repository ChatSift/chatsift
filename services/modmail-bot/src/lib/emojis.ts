import { Buffer } from 'node:buffer';
import { RedisStore } from '@chatsift/backend-core';
import type { API } from '@discordjs/core';
import { CDNRoutes, ImageFormat, RouteBases } from '@discordjs/core';
import type { RawFile } from '@discordjs/rest';
import { createRecipe, DataType } from 'bin-rw';

/**
 * Matches Discord's custom-emote shorthand (`<:name:id>`, `<a:name:id>` for animated) anywhere inside
 * free text — unlike the whole-string-anchored regex used elsewhere to parse a single stored
 * `Category.emoji` value (`components/createTicket.ts`), this one is global/unanchored so every
 * occurrence inside a relayed message or staff reply gets found.
 */
const EMOJI_TOKEN_PATTERN = /<(?<animated>a)?:(?<name>\w{2,32}):(?<id>\d{17,20})>/g;

/**
 * Longer than the 5-minute TTL other guild-data caches in this codebase use (`services/api`'s
 * `guildDataCache.ts`) — this check runs on every relayed user message and every staff reply, far more
 * often than those, so it's worth trading a bit more staleness (a just-added/removed emote taking up to
 * this long to be recognized) for meaningfully less REST traffic.
 */
const GUILD_EMOJI_IDS_TTL_MS = 30 * 60 * 1_000;

interface GuildEmojiIds {
	ids: string[];
}

const GuildEmojiIdsStore = new RedisStore<GuildEmojiIds>({
	TTL: GUILD_EMOJI_IDS_TTL_MS,
	recipe: createRecipe({
		ids: [DataType.String],
	}),
	makeKey: (guildId: string) => `modmail:guild-emojis:${guildId}`,
	storeOld: false,
});

/**
 * The ticket's own guild's custom emote ids — Redis-cached (see `GUILD_EMOJI_IDS_TTL_MS`) since this is
 * checked on essentially every relayed message. Only ids are needed: a token's own name/animated flag
 * already comes from parsing the message content itself (see `EmojiToken`), not from the guild's list.
 */
export async function fetchGuildEmojiIds(guildId: string, api: API): Promise<Set<string>> {
	const cached = await GuildEmojiIdsStore.get(guildId);
	if (cached) {
		return new Set(cached.ids);
	}

	const emojisRaw = await api.guilds.getEmojis(guildId);
	// `id` is typed nullable on discord-api-types' shared `APIPartialEmoji` base only for the
	// reaction-emoji case (a unicode emoji reaction) -- a guild's own custom emoji list from this
	// endpoint always has it populated.
	const ids = emojisRaw.map((emoji) => emoji.id!);
	await GuildEmojiIdsStore.set(guildId, { ids });
	return new Set(ids);
}

export interface EmojiToken {
	animated: boolean;
	id: string;
	name: string;
}

function parseEmojiTokens(content: string): EmojiToken[] {
	return [...content.matchAll(EMOJI_TOKEN_PATTERN)].map((match) => {
		const groups = match.groups!;
		return {
			animated: Boolean(groups['animated']),
			id: groups['id']!,
			name: groups['name']!,
		};
	});
}

/**
 * Same CDN-format logic used to fix issue #234 in the dashboard's `Emoji.tsx`: some animated custom
 * emotes are natively webp-sourced rather than gif-sourced, and Discord's CDN 404s a `.gif` request for
 * those. `.webp` always resolves regardless of source format; `?animated=true` is required for it to
 * actually play back the animation instead of a static first frame.
 */
export function emojiCdnUrl(id: string, animated: boolean): string {
	const base = `${RouteBases.cdn}${CDNRoutes.emoji(id, animated ? ImageFormat.WebP : ImageFormat.PNG)}`;
	return animated ? `${base}?animated=true` : base;
}

/**
 * Direction 1 (user message \-\>mod thread): a token whose emote lives in the ticket's own guild is left
 * untouched and renders inline as usual. Anything else gets reduced to a name-only hyperlink to the
 * emote's CDN image, since Discord shows an unstyled, un-rendered `:name:` placeholder for a custom
 * emote it can't resolve rather than an actual image -- this way the mod at least gets a clickable
 * preview instead of dead text.
 */
export function resolveContentForRelay(content: string, guildEmojiIds: Set<string>): string {
	return content.replaceAll(
		EMOJI_TOKEN_PATTERN,
		(raw: string, animated: string | undefined, name: string, id: string) => {
			if (guildEmojiIds.has(id)) {
				return raw;
			}

			return `[:${name}:](${emojiCdnUrl(id, Boolean(animated))})`;
		},
	);
}

/**
 * Direction 2 (staff reply \-\>user thread): unlike the relay direction above, a foreign emote here isn't
 * rewritten -- the reply is rejected outright before anything is sent (see `buildForeignEmojiRejection`),
 * since a mod can actually go fix their message and retry, unlike an already-sent user message.
 */
export function findForeignEmojiTokens(content: string, guildEmojiIds: Set<string>): EmojiToken[] {
	return parseEmojiTokens(content).filter((token) => !guildEmojiIds.has(token.id));
}

/**
 * Discord's interaction-response `content` is hard-capped at 2,000 characters -- unlike regular
 * messages, that limit does *not* scale to 4,000 for Nitro users, since interaction responses are
 * webhook-authored (by the bot/app), not user-authored. A modal/option can carry up to 4,000 characters
 * (see `commands/reply.ts`/`replyQuick.ts`), so the echoed-back copy can't always be inlined.
 */
const MAX_INLINE_CONTENT_LENGTH = 2_000;

/**
 * Picks a fence at least one backtick longer than the longest run already inside `content` -- guarantees
 * the code block's own delimiters can never be confused with backticks the mod's original text happens
 * to contain, so the copy-pasted block is always faithful.
 */
function fenceFor(content: string): string {
	const longestRun = Math.max(0, ...[...content.matchAll(/`+/g)].map((match) => match[0].length));
	return '`'.repeat(Math.max(3, longestRun + 1));
}

export interface ForeignEmojiRejection {
	content: string;
	files?: RawFile[];
}

/**
 * Builds the rejection response for a staff reply that references an emote outside the ticket's guild:
 * names the offending emote(s), and gives the mod a guaranteed-faithful copy of what they typed so
 * fixing and resending isn't frustrating. Inlined as a fenced code block when it fits Discord's 2,000
 * character interaction-response cap; falls back to a `.txt` attachment for anything longer, since
 * truncating would mean the mod doesn't actually get their full text back.
 */
export function buildForeignEmojiRejection(
	foreignTokens: EmojiToken[],
	originalContent: string,
): ForeignEmojiRejection {
	const uniqueNames = [...new Set(foreignTokens.map((token) => `:${token.name}:`))];
	const plural = uniqueNames.length === 1 ? '' : 's';
	const preamble = `❌ Your reply includes an emote${plural} not from this server (${uniqueNames.join(', ')}), so it can't be sent. Fix ${
		uniqueNames.length === 1 ? 'it' : 'them'
	} and run the command again -- your original text is below so you don't lose it.`;

	const fence = fenceFor(originalContent);
	const inline = `${preamble}\n${fence}\n${originalContent}\n${fence}`;

	if (inline.length <= MAX_INLINE_CONTENT_LENGTH) {
		return { content: inline };
	}

	return {
		content: preamble,
		files: [
			{
				data: Buffer.from(originalContent, 'utf8'),
				name: 'reply.txt',
				contentType: 'text/plain; charset=utf-8',
			},
		],
	};
}
