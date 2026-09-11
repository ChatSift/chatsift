import { expect, test } from 'vitest';
import type { RecentPage } from '../recentPages';
import { pushRecentPage, RECENT_PAGES_LIMIT } from '../recentPages';

function page(href: string): RecentPage {
	return { bot: 'MODMAIL', guildId: '100', guildName: 'Nightshade Collective', href, label: href, path: 'ModMail' };
}

test('a revisited page moves to the front rather than appearing twice', () => {
	const pages = [page('/a'), page('/b'), page('/c')];
	expect(pushRecentPage(pages, page('/c')).map((entry) => entry.href)).toStrictEqual(['/c', '/a', '/b']);
});

test('the list is capped, dropping the oldest', () => {
	const pages = Array.from({ length: RECENT_PAGES_LIMIT }, (_, index) => page(`/${index}`));
	const next = pushRecentPage(pages, page('/new'));

	expect(next).toHaveLength(RECENT_PAGES_LIMIT);
	expect(next[0]!.href).toBe('/new');
	expect(next.some((entry) => entry.href === `/${RECENT_PAGES_LIMIT - 1}`)).toBe(false);
});
