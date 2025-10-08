import type { MeGuild } from '@chatsift/api';
import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/utils/util';

function getGuildAcronym(guildName: string) {
	return guildName
		.replaceAll("'s ", ' ')
		.replaceAll(/\w+/g, (substring) => substring[0]!)
		.replaceAll(/\s/g, '');
}

export interface GuildIconProps {
	readonly data: MeGuild;
	readonly disableLink?: boolean;
	readonly hasBots: boolean;
}

export function GuildIcon({ data, hasBots, disableLink }: GuildIconProps) {
	const icon = data?.icon ? `https://cdn.discordapp.com/icons/${data.id}/${data.icon}.png` : null;
	const url = hasBots ? `/dashboard/${data.id}` : undefined;

	return (
		<div className="flex flex-row items-center">
			<Link className={cn((disableLink || !url) && 'pointer-events-none')} href={url ?? '#'}>
				{icon ? (
					<Image
						alt="Guild icon"
						className="flex h-12 w-12 items-center justify-center rounded-full border-on-secondary bg-on-tertiary dark:border-on-secondary-dark dark:bg-on-tertiary-dark"
						height={48}
						src={icon}
						width={48}
					/>
				) : (
					<p className="flex h-12 w-12 items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap rounded-full border-on-secondary bg-on-tertiary after:max-w-[70%] dark:border-on-secondary-dark dark:bg-on-tertiary-dark">
						{getGuildAcronym(data.name)}
					</p>
				)}
			</Link>
		</div>
	);
}
