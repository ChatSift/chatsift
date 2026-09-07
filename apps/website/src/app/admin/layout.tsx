import type { Metadata } from 'next';
import type { PropsWithChildren } from 'react';
import { Suspense } from 'react';
import { NavGateProvider } from '@/components/common/NavGate';

export const metadata: Metadata = {
	title: 'Admin',
	robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: PropsWithChildren) {
	return (
		<Suspense fallback={null}>
			<NavGateProvider>{children}</NavGateProvider>
		</Suspense>
	);
}
