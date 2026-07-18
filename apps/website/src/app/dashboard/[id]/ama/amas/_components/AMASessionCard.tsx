import Link from 'next/link';
import type { AMASessionWithCount } from '@/api/routes/ama';
import { cn } from '@/utils/util';

interface AMASessionCardProps {
	readonly data: AMASessionWithCount;
}

export function AMASessionCard({ data }: AMASessionCardProps) {
	return (
		<Link
			className={cn(
				'flex h-36 w-full flex-col gap-3 rounded-lg border border-on-secondary bg-card p-4 hover:border-misc-accent dark:border-on-secondary-dark dark:bg-card-dark',
				data.ended && 'opacity-60 hover:opacity-100',
			)}
			href={`/dashboard/${data.guildId}/ama/amas/${data.id}`}
		>
			<div className="flex flex-col gap-1">
				<h3 className="overflow-hidden overflow-ellipsis whitespace-nowrap text-lg font-medium text-primary dark:text-primary-dark">
					{data.title}
				</h3>
				<p className="text-sm text-secondary dark:text-secondary-dark">
					{data.questionCount} {data.questionCount === 1 ? 'question' : 'questions'}
				</p>
			</div>
			<div className="mt-auto flex items-center gap-2">
				<span
					className={cn(
						'rounded px-2 py-1 text-xs font-medium',
						data.ended
							? 'bg-misc-danger/10 text-misc-danger'
							: 'bg-misc-accent/10 text-misc-accent',
					)}
				>
					{data.ended ? 'Ended' : 'Active'}
				</span>
			</div>
		</Link>
	);
}
