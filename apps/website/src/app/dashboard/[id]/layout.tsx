import type { PropsWithChildren } from 'react';
import GuildConfigSidebar from '~/components/dashboard/config/GuildConfigSidebar';

export default async function DashboardGuildLayout({ children }: PropsWithChildren) {
	return (
		<div className="flex min-h-0 flex-auto flex-row">
			<GuildConfigSidebar />
			{children}
		</div>
	);
}
