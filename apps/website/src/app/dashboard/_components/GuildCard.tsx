import type { MeGuild } from '@chatsift/api';
import Link from 'next/link';
import { GuildIcon } from '@/components/common/GuildIcon';
import { SvgAMA } from '@/components/icons/SvgAMA';
import { cn } from '@/utils/util';

interface GuildCardProps {
	readonly data: MeGuild;
	readonly variant?: 'compact' | 'detailed';
}

export default function GuildCard({ data, variant = 'compact' }: GuildCardProps) {
	const hasBots = data.bots.length > 0;
	const url = hasBots ? `/dashboard/${data.id}` : undefined;
	const isDetailed = variant === 'detailed';

	return (
		<div
			className={cn(
				'flex rounded-lg border-[1px] border-on-secondary p-4 dark:border-on-secondary-dark',
				hasBots ? 'bg-card dark:bg-card-dark' : 'group',
				isDetailed ? 'w-full flex-row gap-3' : 'h-36 w-[80vw] flex-col gap-3 md:w-52',
			)}
		>
			{isDetailed ? (
				<>
					<div className="flex flex-row gap-4">
						<GuildIcon data={data} disableLink hasBots={hasBots} />
						<div className="flex flex-col gap-1">
							<p className="content-center w-full overflow-hidden overflow-ellipsis whitespace-nowrap text-lg font-medium text-primary dark:text-primary-dark">
								{data.name}
							</p>
							{hasBots ? (
								<ul className="flex flex-row gap-1">
									{data.bots.includes('AMA') && (
										<li>
											<SvgAMA />
										</li>
									)}
								</ul>
							) : (
								<p className="text-base text-secondary dark:text-secondary-dark">No bots active</p>
							)}
						</div>
					</div>

					<div className="ml-auto flex flex-col gap-1 text-right">
						{data.approximate_member_count !== undefined && (
							<p className="text-base text-secondary dark:text-secondary-dark">
								{data.approximate_member_count.toLocaleString()} member(s)
							</p>
						)}
						{data.approximate_presence_count !== undefined && (
							<p className="text-base text-secondary dark:text-secondary-dark">
								{data.approximate_presence_count?.toLocaleString() ?? '0'} online
							</p>
						)}
					</div>
				</>
			) : (
				<>
					<GuildIcon data={data} hasBots={hasBots} />
					<div className="flex flex-col gap-1">
						<p className="w-full overflow-hidden overflow-ellipsis whitespace-nowrap text-lg font-medium text-primary group-hover:hidden dark:text-primary-dark">
							{url ? (
								<Link href={url} prefetch>
									{data.name}
								</Link>
							) : (
								data.name
							)}
						</p>

						{hasBots ? (
							<ul className="flex flex-row gap-1">
								{data.bots.includes('AMA') && (
									<li>
										<SvgAMA />
									</li>
								)}
							</ul>
						) : (
							<>
								<p className="text-lg font-normal text-secondary group-hover:hidden dark:text-secondary-dark">
									Not invited
								</p>
								<div className="hidden flex-col gap-1 group-hover:flex">
									<p className="text-lg font-medium text-primary dark:text-primary-dark">Invite a bot:</p>
									<ul className="flex flex-row gap-3">
										<li>
											<Link href="/invites/ama">
												<SvgAMA />
											</Link>
										</li>
									</ul>
								</div>
							</>
						)}
					</div>
				</>
			)}
		</div>
	);
}
