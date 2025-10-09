import { HydrationBoundary } from '@tanstack/react-query';
import { server } from '@/data/server.js';

export default async function AMAsLayout({ children, params }: LayoutProps<'/dashboard/[id]/ama/amas'>) {
	const { id } = await params;

	return (
		<HydrationBoundary state={await server.guilds(id).ama.amas({ include_ended: false }).prefetch()}>
			{children}
		</HydrationBoundary>
	);
}
