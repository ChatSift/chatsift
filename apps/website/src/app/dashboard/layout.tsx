import type { Metadata } from 'next';
import type { PropsWithChildren } from 'react';
import { Suspense } from 'react';
import { NavGateProvider } from '@/components/common/NavGate';
import { CommandPaletteProvider } from '@/components/dashboard/CommandPalette';
import { socialMetadata } from '@/utils/site';

/**
 * Generic card for the whole dashboard subtree (#295). Nothing here can ever be guild-specific: the only
 * requests that reach these routes without a session are the link unfurlers `proxy.ts` lets through, and
 * they have no way to see which servers the person who pasted the link can manage -- nor should they.
 */
export const metadata: Metadata = socialMetadata({
	title: 'Dashboard',
	description: 'Configure and manage your ChatSift bots.',
	path: '/dashboard',
});

export default function DashboardLayout({ children }: PropsWithChildren) {
	// `NavGateProvider` itself calls `useSearchParams()`. Next requires a Suspense boundary around that for
	// static prerendering to succeed, even though every dashboard route also independently forces dynamic
	// rendering via `cookies()` -- Next still attempts a static shell first and fails the build without this.
	//
	// The palette sits inside the gate so `me` is always loaded by the time it can open, and above `[id]` so
	// its shortcut also works from the server list.
	return (
		<Suspense fallback={null}>
			<NavGateProvider>
				<CommandPaletteProvider>{children}</CommandPaletteProvider>
			</NavGateProvider>
		</Suspense>
	);
}
