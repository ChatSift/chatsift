import { Avatar } from './Avatar';
import { GenericAvatarImage, GenericAvatarInitials } from './GenericAvatarImages';
import { Skeleton } from './Skeleton';
import { cn } from '@/utils/util';

interface GenericAvatarProps {
	readonly assetURL: string | undefined;
	readonly className: string;
	readonly disableLink?: boolean;
	// Only meaningful when `disableLink` isn't set -- a non-clickable avatar has nothing to link to, so
	// there's no reason to require callers to invent a placeholder href just to satisfy this prop.
	readonly href?: string | undefined;
	readonly initials: string;
	readonly isLoading: boolean;
}

export function GenericAvatar({ className, href, disableLink, isLoading, assetURL, initials }: GenericAvatarProps) {
	const content = (
		<Avatar className={className}>
			{isLoading ? (
				<Skeleton className={className} />
			) : assetURL ? (
				<GenericAvatarImage assetURL={assetURL} className={className} />
			) : (
				<GenericAvatarInitials className={className} initials={initials} />
			)}
		</Avatar>
	);

	if (disableLink || !href) {
		return <div className={cn(disableLink && 'pointer-events-none')}>{content}</div>;
	}

	return (
		<a className={cn(disableLink && 'pointer-events-none')} href={href}>
			{content}
		</a>
	);
}
