import { HydrationBoundary } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { Toaster } from '~/components/common/Toaster';
import Footer from '~/components/footer/Footer';
import Navbar from '~/components/header/Navbar';
import { prefetchUserMe } from '~/data/userMe/prefetch';
import { cn } from '~/util/util';

export default async function RootTemplate({
	children,
	className,
}: PropsWithChildren<{ readonly className?: string }>) {
	return (
		<HydrationBoundary state={await prefetchUserMe()}>
			<div className="h-scren flex min-h-screen flex-col">
				<Navbar />
				<div className="flex flex-[1_1_auto] flex-grow flex-col gap-8">
					<main
						className={cn(
							'mx-auto mb-auto flex max-w-[80vw] flex-col justify-center gap-6 pt-6 md:min-w-[912px]',
							className,
						)}
					>
						{children}
					</main>
					<Footer />
				</div>
			</div>
			<Toaster />
		</HydrationBoundary>
	);
}
