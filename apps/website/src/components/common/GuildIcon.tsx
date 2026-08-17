import Image from 'next/image';
import Link from 'next/link';
import type { PropsWithChildren } from 'react';
import type { MeGuild } from '@/api/routes/auth';
import { getGuildAcronym } from '@/utils/util';

export interface GuildIconProps {
	readonly data: MeGuild;
	readonly disableLink?: boolean;
	readonly hasBots: boolean;
	/**
	 * Pixel size for both dimensions. Defaults to 48 (the original fixed size).
	 */
	readonly size?: number;
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

export function GuildIcon({ data, hasBots, disableLink, size = 48 }: GuildIconProps) {
	const icon = data?.icon ? `https://cdn.discordapp.com/icons/${data.id}/${data.icon}.png` : null;
	const url = hasBots ? `/dashboard/${data.id}` : undefined;
	const dimensions = { height: size, width: size };
	// The acronym fallback otherwise inherits whatever text size its surroundings use -- fine at the
	// original fixed 48px, but overflows badly at a smaller `size` (e.g. GuildNav's compact icon). Scaled
	// relative to the circle itself so it stays legible and contained at any size.
	const acronymFontSize = Math.max(size * 0.4, 10);

	return (
		<div className="flex flex-row items-center">
			<Parent disableLink={disableLink} url={url}>
				{icon ? (
					<Image
						alt={`${data.name} icon`}
						className="flex items-center justify-center rounded-full border-on-secondary bg-on-tertiary dark:border-on-secondary-dark dark:bg-on-tertiary-dark"
						src={icon}
						style={dimensions}
						{...dimensions}
					/>
				) : (
					<p
						aria-label={data.name}
						className="flex items-center justify-center truncate rounded-full border-on-secondary bg-on-tertiary font-medium leading-none after:max-w-[70%] dark:border-on-secondary-dark dark:bg-on-tertiary-dark"
						style={{ ...dimensions, fontSize: acronymFontSize }}
					>
						{getGuildAcronym(data.name)}
					</p>
				)}
			</Parent>
		</div>
	);
}
