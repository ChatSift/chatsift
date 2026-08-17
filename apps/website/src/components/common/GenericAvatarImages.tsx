import { AvatarFallback, AvatarImage } from './Avatar';
import { cn } from '@/utils/util';

interface GenericAvatarInitialsProps {
	readonly className?: string;
	readonly initials: string;
}

/**
 * The `overflow-hidden text-ellipsis whitespace-nowrap` triple below is deliberately **not** collapsed to
 * `truncate`, unlike every other place in this app that spells it out.
 *
 * `cn` is `twMerge`, and the two are not interchangeable once a caller's `className` is merged on top:
 * `twMerge('overflow-hidden …', 'overflow-visible')` drops `overflow-hidden` so the caller wins, whereas
 * `twMerge('truncate', 'overflow-visible')` keeps both — leaving which one applies down to stylesheet order
 * rather than the caller's intent. Spelled out, each utility stays individually overridable.
 */
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
			<AvatarImage className={className} src={assetURL} />
			<AvatarFallback className={className} />
		</>
	);
}
