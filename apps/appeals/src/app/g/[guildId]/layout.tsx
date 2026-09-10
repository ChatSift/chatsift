import type { PropsWithChildren } from 'react';
import { socialMetadata } from '@/utils/site';

/**
 * Static rather than `generateMetadata`: resolving the guild's name for the title would mean a Discord call on
 * every crawl of a URL anybody can construct, and the name is not ours to publish anyway -- the appellant sees
 * it once they are signed in and the ban is confirmed.
 */
export const metadata = socialMetadata({
	title: 'Appeal a ban',
	description: 'Ask the moderators of this server to take another look at your ban.',
	path: '/g',
});

export default async function GuildAppealLayout({ children }: PropsWithChildren) {
	return children;
}
