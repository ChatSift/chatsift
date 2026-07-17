import type { Metadata } from 'next';
import { me } from '@/api/routes/auth';
import { NavGateCheck } from '@/components/common/NavGate';

export async function generateMetadata({ params }: LayoutProps<'/dashboard/[id]'>): Promise<Metadata> {
	const { id } = await params;
	let name;

	try {
		const data = await me.queryFn(false);
		const guild = data?.guilds.find((g) => g.id === id);
		name = guild?.name;
	} catch (error) {
		console.error(error);
		name = null;
	}

	return {
		title: name ?? 'Server not found',
	};
}

export default async function GuildLayout({ children }: LayoutProps<'/dashboard/[id]'>) {
	return <NavGateCheck checkForGuildAccess>{children}</NavGateCheck>;
}
