'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/common/Button';
import { LinkButton } from '@/components/marketing/LinkButton';

export default function NotFound() {
	const router = useRouter();

	return (
		<div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
			<p className="text-6xl font-medium text-on-secondary dark:text-on-secondary-dark">404</p>
			<p className="text-2xl font-medium text-primary dark:text-primary-dark">Page not found</p>
			<p className="max-w-md text-lg text-secondary dark:text-secondary-dark">
				The page you're looking for doesn't exist, or may have moved.
			</p>
			<div className="mt-3 flex flex-col gap-3 sm:flex-row">
				{/*
					A plain `Link` so this works even with the client bundle that renders `Button` never loading -- the
					primary way out of a 404 shouldn't depend on JS having hydrated.
				*/}
				<LinkButton href="/">Return home</LinkButton>
				<Button
					className="justify-center rounded-md border border-on-secondary px-5 py-2.5 text-lg font-medium text-primary dark:border-on-secondary-dark dark:text-primary-dark"
					onPress={() => router.back()}
				>
					Go back
				</Button>
			</div>
		</div>
	);
}
