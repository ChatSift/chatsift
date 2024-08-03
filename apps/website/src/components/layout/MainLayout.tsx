import { HydrationBoundary } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import Footer from '~/app/footer/Footer';
import { Toaster } from '~/components/common/Toaster';
import Navbar from '~/components/header/Navbar';
import { prefetchUserMe } from '~/data/userMe/prefetch';

// Layout meant for / and /dashboard, which both need user state at the very least for the navbar.
export default async function MainLayout({ children }: PropsWithChildren) {
	return (
		<HydrationBoundary state={await prefetchUserMe()}>
			<div className="h-scren flex min-h-screen flex-col">
				<Navbar />
				<div className="flex flex-[1_1_auto] flex-grow flex-col">
					<main className="mx-auto flex max-w-[80vw] flex-col justify-center gap-6 pt-6 md:min-w-[912px]">
						{children}
					</main>
					<Footer />
					<Toaster />
				</div>
			</div>
		</HydrationBoundary>
	);
}
