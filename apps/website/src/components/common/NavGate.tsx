// TODO: Guild based gate

'use client';

import { useRouter } from 'next/navigation';
import type { PropsWithChildren } from 'react';
import { useEffect } from 'react';
import { Skeleton } from './Skeleton';
import { client } from '@/data/client';

interface NavGateProps extends PropsWithChildren {
	readonly checkForGlobalAdmin?: boolean;
}

export function NavGate({ children, checkForGlobalAdmin }: NavGateProps) {
	// TODO: Handle error?
	const { isLoading, data: user, error } = client.auth.useMe();
	const router = useRouter();

	useEffect(() => {
		if (!isLoading && (user === null || (checkForGlobalAdmin && !user!.isGlobalAdmin))) {
			router.replace('/login');
		}
	}, [checkForGlobalAdmin, isLoading, user, router]);

	if (isLoading || user === null) {
		return <Skeleton className="w-full h-[50vh]" />;
	}

	return <>{children}</>;
}
