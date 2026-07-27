import { BOTS } from '@chatsift/core';
import Link from 'next/link';
import type { MeGuild } from '@/api/routes/auth';
import { GuildIcon } from '@/components/common/GuildIcon';
import { Bots } from '@/utils/bots';
import { cn } from '@/utils/util';

interface GuildCardProps {
	readonly data: MeGuild;
}

const BOT_ICON_SIZE = 28;

export default function GuildCard({ data }: GuildCardProps) {
	const hasBots = data.bots.length > 0;
	const url = hasBots ? `/dashboard/${data.id}` : undefined;

	return (
		<div
			className={cn(
				'relative flex h-[9.5rem] w-full min-w-0 flex-col gap-3 overflow-hidden rounded-lg border-[1px] border-on-secondary p-3 dark:border-on-secondary-dark',
				hasBots ? 'bg-card dark:bg-card-dark' : 'group',
			)}
		>
			<GuildIcon data={data} disableLink={hasBots} hasBots={hasBots} />

			<div className="flex min-w-0 flex-col gap-1">
				<p className="truncate text-lg font-medium text-primary dark:text-primary-dark">{data.name}</p>

				{hasBots ? (
					<ul className="flex flex-row items-center gap-1">
						{data.bots.map((bot) => {
							const { Icon, label } = Bots[bot];
							return (
								<li key={bot}>
									<Icon height={BOT_ICON_SIZE} width={BOT_ICON_SIZE} />
									<span className="sr-only">{label}</span>
								</li>
							);
						})}
					</ul>
				) : (
					<div className="grid">
						<p className="col-start-1 row-start-1 text-lg font-normal text-secondary group-hover:invisible dark:text-secondary-dark">
							Not invited
						</p>
						<div className="invisible col-start-1 row-start-1 flex flex-row items-center gap-3 group-hover:visible">
							<p className="text-lg font-medium text-primary dark:text-primary-dark">Invite a bot:</p>
							<ul className="flex flex-row items-center gap-3">
								{BOTS.map((bot) => {
									const { Icon, label } = Bots[bot];
									return (
										<li key={bot}>
											<a href={`/invites/${bot.toLowerCase()}`}>
												<Icon height={BOT_ICON_SIZE} width={BOT_ICON_SIZE} />
												<span className="sr-only">Invite {label}</span>
											</a>
										</li>
									);
								})}
							</ul>
						</div>
					</div>
				)}
			</div>

			{hasBots && url ? (
				<Link
					className="absolute inset-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-misc-accent"
					href={url}
					prefetch
				>
					<span className="sr-only">{data.name}</span>
				</Link>
			) : null}
		</div>
	);
}
