'use client';

import { useParams, useRouter } from 'next/navigation';
import type { PropsWithChildren } from 'react';
import { useEffect } from 'react';
import { Skeleton } from './Skeleton';
import { client } from '@/data/client';

interface NavGateProps extends PropsWithChildren {
	readonly checkForGlobalAdmin?: boolean;
	readonly checkForGuildAccess?: boolean;
}

export function NavGate({ children, checkForGlobalAdmin, checkForGuildAccess }: NavGateProps) {
	// TODO: Handle error?
	const { isLoading, data: user, error } = client.auth.useMe();
	const router = useRouter();
	const params = useParams<{ id?: string }>();

	useEffect(() => {
		if (!isLoading) {
			if (user === null || (checkForGlobalAdmin && !user!.isGlobalAdmin)) {
				router.replace('/login');
				return;
			}

			if (checkForGuildAccess) {
				if (!params.id) {
					throw new Error('Guild ID param is required when checkForGuildAccess is true');
				}

				const hasAccess = user?.isGlobalAdmin ?? user!.guilds.some((g) => g.id === params.id && g.meCanManage);
				if (!hasAccess) {
					router.replace('/dashboard');
				}
			}
		}
	}, [checkForGlobalAdmin, checkForGuildAccess, isLoading, user, router, params]);

	if (isLoading || user === null) {
		return <Skeleton className="w-full h-[50vh]" />;
	}

	return <>{children}</>;
}
