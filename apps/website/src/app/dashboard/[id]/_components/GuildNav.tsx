'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { FaWrench } from 'react-icons/fa';
import { useGrantAuth } from '@/api/grant';
import { useMe } from '@/api/routes/auth';
import { Bots } from '@/utils/bots';
import { cn } from '@/utils/util';

interface NavItem {
	readonly exact?: boolean;
	readonly href: string;
	readonly icon: React.ReactNode;
	readonly label: string;
}

function navLinkClassName(isActive: boolean) {
	return cn(
		'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
		isActive
			? 'bg-on-tertiary text-primary dark:bg-on-tertiary-dark dark:text-primary-dark'
			: 'text-secondary hover:bg-on-tertiary hover:text-primary dark:text-secondary-dark dark:hover:bg-on-tertiary-dark dark:hover:text-primary-dark',
	);
}

/**
 * Persistent sub-nav for everything under `/dashboard/[id]`. Relies on the parent `NavGateCheck` (see
 * `[id]/layout.tsx`) having already gated out guilds the user can't access, so `guild` below is assumed to exist.
 * New products (e.g. ModMail) show up here automatically once they're added to `BOTS`/`Bots` — no per-product wiring.
 */
export function GuildNav() {
	const { data: me } = useMe();
	const params = useParams<{ id: string }>();
	const pathname = usePathname();
	const grant = useGrantAuth();

	const guild = me?.guilds.find((g) => g.id === params.id);
	if (!guild || !pathname) {
		return null;
	}

	const items: NavItem[] = [
		{
			label: 'Overview',
			href: `/dashboard/${guild.id}`,
			icon: null,
			exact: true,
		},
		{
			label: 'Settings',
			href: `/dashboard/${guild.id}/settings`,
			icon: <FaWrench className="h-4 w-4" />,
		},
		...guild.bots.map((bot) => {
			const { Icon } = Bots[bot];
			return {
				label: bot,
				href: `/dashboard/${guild.id}/${bot.toLowerCase()}`,
				icon: <Icon height={16} width={16} />,
			};
		}),
	];

	return (
		<nav className="flex items-center gap-2 overflow-x-auto border-b border-on-secondary pb-3 dark:border-on-secondary-dark">
			{items.map((item) => {
				const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);

				// While a one-time grant token is active, every page but the one it links to would 401 (the
				// grant only authorizes that single action) -- render tabs as non-interactive rather than
				// hiding them, so the dashboard chrome still looks structurally normal.
				if (grant) {
					return (
						<span
							aria-disabled="true"
							className={cn(navLinkClassName(isActive), 'cursor-not-allowed opacity-60')}
							key={item.href}
						>
							{item.icon}
							{item.label}
						</span>
					);
				}

				return (
					<Link className={navLinkClassName(isActive)} href={item.href} key={item.href} prefetch>
						{item.icon}
						{item.label}
					</Link>
				);
			})}
		</nav>
	);
}
