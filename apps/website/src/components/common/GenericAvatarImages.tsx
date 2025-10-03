import { AvatarFallback, AvatarImage } from './Avatar';
import { cn } from '@/utils/util';

interface GenericAvatarInitialsProps {
	readonly className?: string;
	readonly initials: string;
}

export function GenericAvatarInitials({ className, initials }: GenericAvatarInitialsProps) {
	return (
		<div
			className={cn(
				'flex h-12 w-12 items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap rounded-full border-on-secondary bg-on-tertiary after:max-w-[70%] dark:border-on-secondary-dark dark:bg-on-tertiary-dark',
				className,
			)}
		>
			{initials.toUpperCase()}
		</div>
	);
}

interface GenericAvatarImageProps {
	readonly assetURL: string;
	readonly className?: string;
}

export function GenericAvatarImage({ className, assetURL }: GenericAvatarImageProps) {
	return (
		<>
			<AvatarImage className={className} crossOrigin="anonymous" src={assetURL} />
			<AvatarFallback className={className} />
		</>
	);
}
