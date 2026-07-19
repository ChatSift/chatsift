import type { PropsWithChildren } from 'react';
import { Suspense } from 'react';
import { NavGateProvider } from '@/components/common/NavGate';

export default function DashboardLayout({ children }: PropsWithChildren) {
	// `NavGateProvider` (and several of its descendants -- GuildNav, DashboardCrumbs, ...) call `useMe()`, which
	// calls `useSearchParams()` via `useGrantAuth()`. Next requires a Suspense boundary around that for static
	// prerendering to succeed, even though every dashboard route also independently forces dynamic rendering
	// via `cookies()` -- Next still attempts a static shell first and fails the build without this.
	return (
		<Suspense fallback={null}>
			<NavGateProvider>{children}</NavGateProvider>
		</Suspense>
	);
}
