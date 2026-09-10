import type { PropsWithChildren } from 'react';
import { socialMetadata } from '@/utils/site';

/**
 * The catch-all at the site root, so this is also the metadata anything unrecognised gets. `noindex` matters
 * more here than anywhere else: without it every mistyped path under the domain is a crawlable page.
 */
export const metadata = socialMetadata({
	title: 'Appeal a ban',
	description: 'Ask the moderators of a Discord server to take another look at your ban.',
	path: '/',
});

export default async function InviteLayout({ children }: PropsWithChildren) {
	return children;
}
