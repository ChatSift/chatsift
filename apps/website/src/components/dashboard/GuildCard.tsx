'use client';

import type { UserMeGuild } from '@chatsift/shared';
import Image from 'next/image';
import SvgAutoModerator from '~/components/svg/SvgAutoModerator';
import { cn } from '~/util/util';

interface GuildCardProps {
	readonly data: UserMeGuild;
}

function getGuildAcronym(guildName: string) {
	return guildName
		.replaceAll("'s ", ' ')
		.replaceAll(/\w+/g, (substring) => substring[0]!)
		.replaceAll(/\s/g, '');
}

export default function GuildCard({ data }: GuildCardProps) {
	const hasBots = data.bots.length > 0;
	const icon = data?.icon ? `https://cdn.discordapp.com/icons/${data.id}/${data.icon}.png` : null;
	const url = hasBots ? `/dashboard/${data.id}` : undefined;

	return (
		<div
			className={cn(
				'flex h-40 w-full flex-col items-start justify-between gap-2 rounded-lg border border-static p-4',
				hasBots ? 'bg-base-200' : 'group',
			)}
		>
			<div className="flex flex-row items-center">
				{icon ? (
					<a href={url}>
						<Image
							src={icon}
							alt="Guild icon"
							width={48}
							height={48}
							className="bg-on-tertiary flex h-12 w-12 items-center justify-center rounded-full border-static"
						/>
					</a>
				) : (
					<a className="bg-on-tertiary flex h-12 w-12 items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap rounded-full border-static after:max-w-[70%]">
						{getGuildAcronym(data.name)}
					</a>
				)}
			</div>
			<div className="flex max-w-full flex-col gap-1">
				<p className="w-full truncate text-lg font-medium text-primary group-hover:hidden">
					<a href={url}>{data.name}</a>
				</p>

				{hasBots ? (
					<ul className="flex flex-row gap-1">
						<>
							{data.bots.includes('automoderator') && (
								<li>
									<SvgAutoModerator />
								</li>
							)}
						</>
					</ul>
				) : (
					<>
						<p className="text-sm font-normal text-secondary group-hover:hidden">Not invited</p>
						<div className="hidden flex-col gap-1 group-hover:flex">
							<p className="text-lg font-medium text-primary">Invite a bot:</p>
							<ul className="flex flex-row gap-3">
								<li>
									<a href="/invites/automoderator">
										<SvgAutoModerator />
									</a>
								</li>
							</ul>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
