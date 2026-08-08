'use client';

import { notFound, useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { PropsWithChildren } from 'react';
import { createContext, useContext, useEffect, useMemo } from 'react';
import { Skeleton } from './Skeleton';
import { useMe } from '@/api/routes/auth';
import { store } from '@/api/store';
import { lastExplicitLogoutAtAtom } from '@/api/token';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { resolveGuildAccess } from '@/hooks/useGuildAccess';
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
	const pathname = usePathname();
	const search = useSearchParams().toString();

	useEffect(() => {
		// `error` must gate this too, not just the render below: on a *refetch* failure (as opposed to a first
		// fetch failing), react-query's error reducer keeps whatever `data` was already cached rather than
		// resetting it — so if `me` had previously resolved to `null`, a later non-401 refetch error (network
		// blip, 500, ...) leaves `user === null` and `isLoading === false` untouched while `error` becomes
		// populated. Without this check that still satisfies the redirect condition below, firing a Discord
		// OAuth redirect at the same moment the render path (further down) is correctly showing UserErrorHandler.
		if (!isLoading && !error && user === null) {
			const lastExplicitLogoutAt = store.get(lastExplicitLogoutAtAtom);
			if (Date.now() - lastExplicitLogoutAt < RECENT_LOGOUT_WINDOW_MS) {
				return;
			}

			router.push(URLS.API.login(search ? `${pathname}?${search}` : pathname));
		}
	}, [isLoading, error, user, router, pathname, search]);

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
	const pathname = usePathname();

	// Guest-only access to the bare guild root is just a landing pad for the redirect below -- there's no
	// actual content there for a guest (that page is the manager-only settings hub), so this is computed
	// during render (not inside the effect) so the "render nothing" branch further down can use it too.
	const { canManage, isAmaGuestOnly } =
		checkForGuildAccess && isAuthenticated
			? resolveGuildAccess(user, params.id)
			: { canManage: true, isAmaGuestOnly: false };
	const isGuildRoot = /^\/dashboard\/[^/]+\/?$/.test(pathname ?? '');
	// The AMA hub (`/dashboard/[id]/ama`) is the same kind of dead end for a guest: manager-framed
	// "configure AMA for your server" copy wrapped around a single link to the sessions list, which is the
	// only thing under it they can open. Folded into the guild-root redirect rather than given its own
	// guest-aware variant, so a guest only ever sees pages that were written for them.
	const isAmaHub = /^\/dashboard\/[^/]+\/ama\/?$/.test(pathname ?? '');
	const isAmaGuestOnlyOnHub = isAmaGuestOnly && (isGuildRoot || isAmaHub);

	useEffect(() => {
		if (!isAuthenticated) {
			return;
		}

		if (checkForGlobalAdmin && !user!.isGlobalAdmin) {
			router.replace('/dashboard');
			return;
		}

		// Centralized here rather than in every page that could be a guest dead end, so none of them need to
		// know guest status exists at all -- they just never render while this is in flight.
		if (isAmaGuestOnlyOnHub) {
			router.replace(`/dashboard/${params.id}/ama/amas`);
		}
	}, [isAuthenticated, checkForGlobalAdmin, user, router, isAmaGuestOnlyOnHub, params.id]);

	// Guild access is checked during render (not the effects above) and uses `notFound()` rather than a
	// redirect: it needs to block the first render of `children` outright, since descendants
	// (DashboardCrumbs, GuildNav, ...) assume the guild exists and throw/misbehave otherwise. An
	// effect-based redirect would let that first, invalid render happen before the navigation fires.
	if (checkForGuildAccess && isAuthenticated) {
		if (!params.id) {
			throw new Error('Guild ID param is required when checkForGuildAccess is true');
		}

		// Membership itself can't be bypassed by `isGlobalAdmin`: `guilds` only ever contains guilds the logged-in
		// user is personally a Discord member of (see `fetchMe`), and every guild-scoped API route re-derives that
		// same list server-side (`isGuildManager` in `isAuthed.ts`) — an admin who isn't a member gets a 403 on
		// every request regardless of what this gate does. `isGlobalAdmin` only waives the `meCanManage` permission
		// check for guilds they do belong to, mirroring the backend's admin bypass of the `adminGuilds` grant.
		//
		// An AMA guest with no general manage access still gets in, but only under this guild's `/ama`
		// subtree, plus the bare guild root (so the effect above has a mounted tree to redirect away from) —
		// everything else (Settings, other bots) 404s for them exactly like any other non-member/non-manager.
		const isAmaPath = /^\/dashboard\/[^/]+\/ama(?:\/|$)/.test(pathname ?? '');
		if (!canManage && !(isAmaGuestOnly && (isAmaPath || isGuildRoot))) {
			notFound();
		}
	}

	// Render nothing on those pages while the redirect effect above fires, instead of flashing manager-only
	// content at a guest-only viewer for one frame.
	if (isAmaGuestOnlyOnHub) {
		return null;
	}

	return <>{children}</>;
}
