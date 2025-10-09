import type { MeGuild } from '@chatsift/api';
import Link from 'next/link';
import { GuildIcon } from '@/components/common/GuildIcon';
import { SvgAMA } from '@/components/icons/SvgAMA';
import { cn } from '@/utils/util';

interface GuildCardProps {
	readonly data: MeGuild;
}

export default function GuildCard({ data }: GuildCardProps) {
	const hasBots = data.bots.length > 0;
	const url = hasBots ? `/dashboard/${data.id}` : undefined;

	return (
		<div
			className={cn(
				'flex h-36 w-[80vw] flex-col gap-3 rounded-lg border-[1px] border-on-secondary p-4 dark:border-on-secondary-dark md:w-52',
				hasBots ? 'bg-card dark:bg-card-dark' : 'group',
			)}
		>
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
		</div>
	);
}
