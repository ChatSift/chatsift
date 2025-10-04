'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/common/Button';

export default function NotFound() {
	const router = useRouter();

	return (
		<div className="flex flex-col items-center justify-center gap-4">
			<p className="text-2xl font-medium text-primary dark:text-primary-dark">
				The page you are looking for could not be found
			</p>
			<Button
				className="flex justify-center gap-2 rounded-md bg-misc-accent px-4 py-3 text-lg font-[550] text-primary-dark md:inline-flex"
				onClick={() => router.back()}
			>
				Go back
			</Button>
		</div>
	);
}
