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
				'flex h-36 w-[80vw] flex-col gap-3 rounded-lg border-[1px] border-on-secondary p-4 md:w-52',
				hasBots ? 'bg-[#FFFFFF][#1C1C21]' : 'group',
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
							className="flex h-12 w-12 items-center justify-center rounded-full border-on-secondary bg-on-tertiary"
						/>
					</a>
				) : (
					<a className="flex h-12 w-12 items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap rounded-full border-on-secondary bg-on-tertiary after:max-w-[70%]">
						{getGuildAcronym(data.name)}
					</a>
				)}
			</div>
			<div className="flex flex-col gap-1">
				<p className="w-full overflow-hidden overflow-ellipsis whitespace-nowrap text-lg font-medium text-primary group-hover:hidden">
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
						<p className="text-lg font-normal text-secondary group-hover:hidden">Not invited</p>
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
