import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { NavGate } from '@/components/common/NavGate';
import { server } from '@/data/server';

export async function generateMetadata({ params }: LayoutProps<'/dashboard/[id]'>): Promise<Metadata> {
	const { id } = await params;
	let name;

	try {
		const { data: me } = await server.auth.me.fetch();
		const guild = me?.guilds.find((g) => g.id === id);
		name = guild?.name;
	} catch (error) {
		console.error(error);
		name = null;
	}

	return {
		title: name ?? 'Server not found',
	};
}

export default async function Layout({ children, params }: LayoutProps<'/dashboard/[id]'>) {
	// const { id } = await params;

	return (
		<NavGate checkForGuildAccess>
			<HydrationBoundary state={await server.prefetchMany([])}>{children}</HydrationBoundary>
		</NavGate>
	);
}
