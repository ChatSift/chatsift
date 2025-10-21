'use client';

import { useParams, useRouter } from 'next/navigation';
import type { PropsWithChildren } from 'react';
import { createContext, useContext, useEffect, useMemo } from 'react';
import { Skeleton } from './Skeleton';
import { client } from '@/data/client';
import { URLS } from '@/utils/urls';

interface NavGateContextValue {
	readonly isAuthenticated: boolean;
	readonly isLoading: boolean;
}

const NavGateContext = createContext<NavGateContextValue | null>(null);

export function useNavGate() {
	const context = useContext(NavGateContext);
	if (!context) {
		throw new Error('useNavGate must be used within NavGateProvider');
	}

	return context;
}

export function NavGateProvider({ children }: PropsWithChildren) {
	const { isLoading, data: user } = client.auth.useMe();
	const router = useRouter();

	useEffect(() => {
		if (!isLoading && user === null) {
			router.push(URLS.API.LOGIN);
		}
	}, [isLoading, user, router]);

	const value = useMemo(
		() => ({
			isAuthenticated: !isLoading && user !== null,
			isLoading,
		}),
		[isLoading, user],
	);

	if (isLoading || user === null) {
		return <Skeleton className="w-full h-[50vh]" />;
	}

	return <NavGateContext.Provider value={value}>{children}</NavGateContext.Provider>;
}

type NavGateCheckProps = PropsWithChildren &
	(
		| {
				readonly checkForGlobalAdmin: true;
				readonly checkForGuildAccess?: never;
		  }
		| {
				readonly checkForGlobalAdmin?: never;
				readonly checkForGuildAccess: true;
		  }
		| {
				readonly checkForGlobalAdmin?: never;
				readonly checkForGuildAccess?: never;
		  }
	);

export function NavGateCheck({ children, checkForGlobalAdmin, checkForGuildAccess }: NavGateCheckProps) {
	const { isAuthenticated } = useNavGate();
	const { data: user } = client.auth.useMe();
	const router = useRouter();
	const params = useParams<{ id?: string }>();

	useEffect(() => {
		if (!isAuthenticated) {
			return;
		}

		if (checkForGlobalAdmin && !user!.isGlobalAdmin) {
			router.replace('/dashboard');
			return;
		}

		if (checkForGuildAccess) {
			if (!params.id) {
				throw new Error('Guild ID param is required when checkForGuildAccess is true');
			}

			const hasAccess = user!.isGlobalAdmin || user!.guilds.some((g) => g.id === params.id && g.meCanManage);
			if (!hasAccess) {
				router.replace('/dashboard');
			}
		}
	}, [isAuthenticated, checkForGlobalAdmin, checkForGuildAccess, user, router, params]);

	return <>{children}</>;
}
