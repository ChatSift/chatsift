'use client';

import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/common/Button';
import { GuildIcon } from '@/components/common/GuildIcon';
import { Heading } from '@/components/common/Heading';
import { Skeleton } from '@/components/common/Skeleton';
import { SvgAMA } from '@/components/icons/SvgAMA';
import { client } from '@/data/client';

export default function GuildPage() {
	const params = useParams<{ id: string }>();
	const router = useRouter();
	const { data: me, isLoading } = client.auth.useMe();

	const guild = me?.guilds.find((g) => g.id === params.id);

	if (isLoading) {
		return <Skeleton className="w-full h-[50vh]" />;
	}

	if (!guild) {
		return (
			<div className="flex flex-col gap-4">
				<p className="text-lg text-secondary dark:text-secondary-dark">Guild not found</p>
			</div>
		);
	}

	return (
		<div className="space-y-8">
			<div className="flex flex-row flex-grow gap-72">
				<div className="space-y-2 w-64">
					<Button
						className="flex items-center gap-2 text-lg text-secondary hover:text-primary dark:text-secondary-dark dark:hover:text-primary-dark"
						onPress={() => router.replace('/dashboard')}
					>
						← Servers
					</Button>

					<Heading title="Server Settings" />
				</div>
			</div>

			<div className="flex h-36 w-full flex-col gap-3 rounded-lg border-[1px] border-on-secondary bg-[#FFFFFF] p-4 dark:border-on-secondary-dark dark:bg-[#1C1C21]">
				<GuildIcon data={guild} hasBots={guild.bots.length > 0} />
				<div className="flex flex-col gap-1">
					<p className="w-full overflow-hidden overflow-ellipsis whitespace-nowrap text-lg font-medium text-primary dark:text-primary-dark">
						{guild.name}
					</p>
					<p className="text-base text-secondary dark:text-secondary-dark">{guild.bots.length} bot(s) active</p>
				</div>
			</div>

			{/* Bot navigation section */}
			<div className="space-y-4">
				<Heading subtitle="Configure your bots" title="Bots" />
				<div className="flex flex-col gap-3">
					{guild.bots.includes('AMA') && (
						<a
							className="flex items-center gap-4 rounded-lg border-[1px] border-on-secondary bg-[#FFFFFF] p-4 hover:bg-on-tertiary dark:border-on-secondary-dark dark:bg-[#1C1C21] dark:hover:bg-on-tertiary-dark"
							href={`/dashboard/${guild.id}/ama`}
						>
							<SvgAMA height={32} width={32} />
							<div className="flex flex-col">
								<p className="text-lg font-medium text-primary dark:text-primary-dark">AMA</p>
								<p className="text-sm text-secondary dark:text-secondary-dark">Configure AMA bot settings</p>
							</div>
						</a>
					)}
				</div>
			</div>
		</div>
	);
}
