import type { MeGuild } from '@chatsift/api';
import Image from 'next/image';
import Link from 'next/link';
import type { PropsWithChildren } from 'react';
import { getGuildAcronym } from '@/utils/util';

export interface GuildIconProps {
	readonly data: MeGuild;
	readonly disableLink?: boolean;
	readonly hasBots: boolean;
}

interface ParentProps extends PropsWithChildren {
	readonly disableLink: boolean | undefined;
	readonly url: string | undefined;
}

function Parent({ children, disableLink, url }: ParentProps) {
	if (disableLink || !url) {
		return <>{children}</>;
	}

	return <Link href={url}>{children}</Link>;
}

export function GuildIcon({ data, hasBots, disableLink }: GuildIconProps) {
	const icon = data?.icon ? `https://cdn.discordapp.com/icons/${data.id}/${data.icon}.png` : null;
	const url = hasBots ? `/dashboard/${data.id}` : undefined;

	return (
		<div className="flex flex-row items-center">
			<Parent disableLink={disableLink} url={url}>
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
			</Parent>
		</div>
	);
}
