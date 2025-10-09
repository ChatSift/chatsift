'use client';

import { BOTS } from '@chatsift/core';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { DashboardCrumbs } from '../_components/DashboardCrumbs';
import GuildCard from '../_components/GuildCard';
import { Heading } from '@/components/common/Heading';
import { Skeleton } from '@/components/common/Skeleton';
import { client } from '@/data/client';
import { Bots } from '@/utils/bots';
import { cn } from '@/utils/util';

export default function GuildPage() {
	const params = useParams<{ id: string }>();
	const { data: me, isLoading } = client.auth.useMe();

	const guild = me?.guilds.find((g) => g.id === params.id);

	if (isLoading) {
		return <Skeleton className="w-full h-[50vh]" />;
	}

	if (!guild) {
		return notFound();
	}

	return (
		<div className="space-y-8">
			<div className="space-y-4">
				<DashboardCrumbs segments={[]} />
				<Heading subtitle="Configure the bots installed in your server" title="Bots" />
				<div className="flex flex-col gap-3">
					{BOTS.map((bot, index) => {
						const { Icon } = Bots[bot];
						const hasIt = guild.bots.includes(bot);

						return (
							<Link
								className={cn(
									'flex items-center gap-4 rounded-lg border-[1px] border-on-secondary bg-card p-4 hover:bg-on-tertiary dark:border-on-secondary-dark dark:bg-card-dark dark:hover:bg-on-tertiary-dark',
									!hasIt && 'opacity-50 hover:opacity-75',
								)}
								href={hasIt ? `/dashboard/${guild.id}/ama` : `/invites/${bot.toLowerCase()}`}
								key={index}
								prefetch
							>
								<Icon height={32} width={32} />
								<div className="flex flex-col">
									<p className="text-lg font-medium text-primary dark:text-primary-dark">{bot}</p>
									<p className="text-sm text-secondary dark:text-secondary-dark">
										{hasIt ? `Configure ${bot} bot settings` : `Invite ${bot} to your server`}
									</p>
								</div>
							</Link>
						);
					})}
				</div>
			</div>
		</div>
	);
}
