import type { PropsWithChildren } from 'react';
import { socialMetadata } from '@/utils/site';

export const metadata = socialMetadata({
	title: 'Your appeals',
	description: 'Every appeal you have filed, and where it stands.',
	path: '/appeals',
});

export default async function AppealsLayout({ children }: PropsWithChildren) {
	return children;
}
