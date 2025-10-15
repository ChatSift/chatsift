'use client';

import { BOTS } from '@chatsift/core';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import type { PropsWithChildren } from 'react';
import { FaWrench } from 'react-icons/fa';
import { DashboardCrumbs } from '../_components/DashboardCrumbs';
import { Heading } from '@/components/common/Heading';
import { Skeleton } from '@/components/common/Skeleton';
import { client } from '@/data/client';
import { Bots } from '@/utils/bots';
import { cn } from '@/utils/util';

interface SectionCardProps extends PropsWithChildren {
	readonly className?: string;
	readonly href: string;
	readonly icon: React.ReactNode;
	readonly linksExternally?: boolean;
	readonly subtext: string;
	readonly text: string;
}

function SectionCard({ linksExternally, className: providedClassName, href, icon, subtext, text }: SectionCardProps) {
	const className = cn(
		'flex items-center gap-4 rounded-lg border-[1px] border-on-secondary bg-card p-4 hover:bg-on-tertiary dark:border-on-secondary-dark dark:bg-card-dark dark:hover:bg-on-tertiary-dark',
		providedClassName,
	);

	const content = (
		<>
			{icon}
			<div className="flex flex-col">
				<p className="text-lg font-medium text-primary dark:text-primary-dark">{text}</p>
				<p className="text-sm text-secondary dark:text-secondary-dark">{subtext}</p>
			</div>
		</>
	);

	return linksExternally ? (
		<Link className={className} href={href} prefetch>
			{content}
		</Link>
	) : (
		<a className={className} href={href}>
			{content}
		</a>
	);
}

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
				<DashboardCrumbs />
				<Heading
					subtitle="Configure the way ChatSift products interact with your server"
					title="Server configuration"
				/>
				<div className="flex flex-col gap-3">
					<SectionCard
						href={`/dashboard/${guild.id}/settings`}
						// TODO
						icon={<FaWrench className="text-misc-accent h-6 w-6" />}
						subtext="View and modify general settings related to your community"
						text="General settings"
					/>
					{BOTS.map((bot, index) => {
						const { Icon } = Bots[bot];
						const hasIt = guild.bots.includes(bot);
						return (
							<SectionCard
								className={hasIt ? '' : 'opacity-50 hover:opacity-75'}
								href={hasIt ? `/dashboard/${guild.id}/ama` : `/invites/${bot.toLowerCase()}`}
								icon={<Icon height={32} width={32} />}
								key={index}
								linksExternally={!hasIt}
								subtext={hasIt ? `Configure ${bot} bot settings` : `Invite ${bot} to your server`}
								text={bot}
							/>
						);
					})}
				</div>
			</div>
		</div>
	);
}
