import type { Metadata } from 'next';
import { GuildNav } from './_components/GuildNav';
import { me } from '@/api/routes/auth';
import { NavGateCheck } from '@/components/common/NavGate';
import { ScopedSessionBanner } from '@/components/dashboard/ScopedSessionBanner';

export async function generateMetadata({ params }: LayoutProps<'/dashboard/[id]'>): Promise<Metadata> {
	const { id } = await params;

	// "No usable session" is the normal path here since #295: `proxy.ts` waves link unfurlers past the OAuth
	// redirect so that dashboard links unfurl as a ChatSift card, and they arrive with no cookie. Titling that
	// "Server not found" would put a false negative in the embed -- a caller who can't see the guild list has
	// learnt nothing about whether the guild exists. Only a *resolved* `/me` that genuinely lacks this guild
	// is the real not-found case.
	//
	// Note `me.queryFn` resolves to `null` on a 401 rather than throwing (it treats "not logged in" as a
	// value, not an error), so the no-session case is this null check, not the `catch` below -- which is left
	// for the genuinely exceptional failures, and lands on the same generic title.
	//
	// The description/`openGraph` the card needs are inherited from `dashboard/layout.tsx`, so only the title
	// has to be restated in either case.
	try {
		const data = await me.queryFn(false);
		if (!data) {
			return { title: 'Dashboard' };
		}

		const guild = data.guilds.find((g) => g.id === id);
		return { title: guild?.name ?? 'Server not found' };
	} catch (error) {
		console.error(error);
		return { title: 'Dashboard' };
	}
}

export default async function GuildLayout({ children }: LayoutProps<'/dashboard/[id]'>) {
	return (
		<NavGateCheck checkForGuildAccess>
			<div className="space-y-6">
				<ScopedSessionBanner />
				<GuildNav />
				{children}
			</div>
		</NavGateCheck>
	);
}
