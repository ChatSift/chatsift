import { cn } from '~/util/util';

export default function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return <div className={cn('bg-on-tertiary animate-pulse rounded-md bg-base-200', className)} {...props} />;
}
