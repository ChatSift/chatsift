import { cn } from '@/utils/util';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn('bg-muted animate-pulse rounded-md bg-on-tertiary dark:bg-on-tertiary-dark', className)}
			{...props}
		/>
	);
}
