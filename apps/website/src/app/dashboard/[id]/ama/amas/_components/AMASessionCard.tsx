import type { AMASessionWithCount } from '@chatsift/api';
import Link from 'next/link';

interface AMASessionCardProps {
	readonly data: AMASessionWithCount;
}

export function AMASessionCard({ data }: AMASessionCardProps) {
	return (
		<Link
			className="flex h-36 w-[80vw] flex-col gap-3 rounded-lg border border-on-secondary bg-card p-4 hover:border-misc-accent dark:border-on-secondary-dark dark:bg-card-dark md:w-52"
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
					className={`rounded px-2 py-1 text-xs font-medium ${data.ended ? 'text-misc-danger' : 'text-misc-accent'}`}
				>
					{data.ended ? 'Ended' : 'Active'}
				</span>
			</div>
		</Link>
	);
}
