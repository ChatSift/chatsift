import type { BotId } from '@chatsift/core';

export interface RecentPage {
	/**
	 * The bot the page belongs to, for the palette's row icon. `null` for a page outside any bot (settings).
	 */
	readonly bot: BotId | null;
	readonly guildId: string;
	readonly guildName: string;
	readonly href: string;
	readonly label: string;
	/**
	 * The trail above `label` as the breadcrumb rendered it, e.g. `ModMail / Snippets`. Never includes the
	 * server: the palette adds `guildName` itself, and only when the page is in a different server.
	 */
	readonly path: string;
}

const STORAGE_KEY = 'chatsift:recent-pages';

export const RECENT_PAGES_LIMIT = 8;

/**
 * Newest first, one entry per href, capped. Pure, so the ordering rule is testable without a storage.
 */
export function pushRecentPage(pages: readonly RecentPage[], page: RecentPage): RecentPage[] {
	return [page, ...pages.filter((candidate) => candidate.href !== page.href)].slice(0, RECENT_PAGES_LIMIT);
}

function isRecentPage(value: unknown): value is RecentPage {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const candidate = value as Record<string, unknown>;
	const bot = candidate['bot'];
	return (
		(bot === null || typeof bot === 'string') &&
		['guildId', 'guildName', 'href', 'label', 'path'].every((key) => typeof candidate[key] === 'string')
	);
}

// Only ever reached from effects and event handlers, but a guard is cheaper than a guarantee.
function storage(): Storage | null {
	return typeof window === 'undefined' ? null : window.localStorage;
}

/**
 * localStorage is the right home for this: it is a per-browser convenience, not account state, and nothing
 * else reads it. Every touch is wrapped because storage can be absent or throw (private windows, blocked
 * site data), and a palette with no Recent group is the whole failure mode.
 */
export function readRecentPages(): RecentPage[] {
	try {
		const raw = storage()?.getItem(STORAGE_KEY);
		if (!raw) {
			return [];
		}

		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter(isRecentPage) : [];
	} catch {
		return [];
	}
}

export function recordRecentPage(page: RecentPage): void {
	try {
		storage()?.setItem(STORAGE_KEY, JSON.stringify(pushRecentPage(readRecentPages(), page)));
	} catch {
		// See `readRecentPages`.
	}
}
