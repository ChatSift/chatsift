import { Avatar } from './Avatar';
import { GenericAvatarImage, GenericAvatarInitials } from './GenericAvatarImages';
import { Skeleton } from './Skeleton';
import { cn } from '@/utils/util';

interface GenericAvatarProps {
	readonly assetURL: string | undefined;
	readonly className: string;
	readonly disableLink?: boolean;
	readonly href: string;
	readonly initials: string;
	readonly isLoading: boolean;
}

export function GenericAvatar({ className, href, disableLink, isLoading, assetURL, initials }: GenericAvatarProps) {
	return (
		<a className={cn(disableLink && 'pointer-events-none')} href={href}>
			<Avatar className={className}>
				{isLoading ? (
					<Skeleton className={className} />
				) : assetURL ? (
					<GenericAvatarImage assetURL={assetURL} className={className} />
				) : (
					<GenericAvatarInitials className={className} initials={initials} />
				)}
			</Avatar>
		</a>
	);
}
