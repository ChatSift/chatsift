import { HydrationBoundary } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { Toaster } from '~/components/common/Toaster';
import Footer from '~/components/footer/Footer';
import Navbar from '~/components/header/Navbar';
import { prefetchUserMe } from '~/data/userMe/prefetch';
import { cn } from '~/util/util';

// Layout meant for / and /dashboard, which both need user state at the very least for the navbar.
export default async function MainLayout({ children, className }: PropsWithChildren<{ readonly className?: string }>) {
	return (
		<HydrationBoundary state={await prefetchUserMe()}>
			<div className="h-scren flex min-h-screen flex-col">
				<Navbar />
				<div className="flex flex-[1_1_auto] flex-grow flex-col">
					<main
						className={cn(
							'mx-auto mb-auto flex max-w-[80vw] flex-col justify-center gap-6 pt-6 md:min-w-[912px]',
							className,
						)}
					>
						{children}
					</main>
					<Footer />
					<Toaster />
				</div>
			</div>
		</HydrationBoundary>
	);
}
