'use client';

import { getDefaultStore } from 'jotai';
import { useParams, useRouter } from 'next/navigation';
import type { PropsWithChildren } from 'react';
import { createContext, useContext, useEffect, useMemo } from 'react';
import { Skeleton } from './Skeleton';
import { useMe } from '@/api/routes/auth';
import { lastExplicitLogoutAtAtom } from '@/api/token';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { URLS } from '@/utils/urls';

/**
 * How long after an explicit `useLogout()` call to trust that `LogoutButton` is already handling navigation,
 * rather than treating `user: null` as a session that expired while browsing and redirecting to Discord OAuth
 * ourselves. Generous relative to how fast a client-side navigation actually completes.
 */
const RECENT_LOGOUT_WINDOW_MS = 3_000;

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
	const { isLoading, data: user, error } = useMe();
	const router = useRouter();

	useEffect(() => {
		// `error` must gate this too, not just the render below: on a *refetch* failure (as opposed to a first
		// fetch failing), react-query's error reducer keeps whatever `data` was already cached rather than
		// resetting it — so if `me` had previously resolved to `null`, a later non-401 refetch error (network
		// blip, 500, ...) leaves `user === null` and `isLoading === false` untouched while `error` becomes
		// populated. Without this check that still satisfies the redirect condition below, firing a Discord
		// OAuth redirect at the same moment the render path (further down) is correctly showing UserErrorHandler.
		if (!isLoading && !error && user === null) {
			const lastExplicitLogoutAt = getDefaultStore().get(lastExplicitLogoutAtAtom);
			if (Date.now() - lastExplicitLogoutAt < RECENT_LOGOUT_WINDOW_MS) {
				return;
			}

			router.push(URLS.API.LOGIN);
		}
	}, [isLoading, error, user, router]);

	const value = useMemo(
		() => ({
			isAuthenticated: !isLoading && user !== null,
			isLoading,
		}),
		[isLoading, user],
	);

	// Must come before the loading/unauthenticated check below: on a non-401 error (network issue, 500, ...)
	// `data` is `undefined`, not `null`, so `user === null` is false and `isLoading` is also false by the time
	// the query settles into its error state — falling through to render `children` with no user data at all,
	// which crashes downstream (NavGateCheck's `user!.foo`, DashboardCrumbs' `me?.guilds` access, etc.).
	if (error) {
		return <UserErrorHandler error={error} />;
	}

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
	const { data: user } = useMe();
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
