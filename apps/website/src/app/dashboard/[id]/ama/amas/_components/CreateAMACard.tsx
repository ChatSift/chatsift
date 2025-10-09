import Link from 'next/link';
import { SvgPlus } from '@/components/icons/SvgPlus';

interface CreateAMACardProps {
	readonly guildId: string;
}

export function CreateAMACard({ guildId }: CreateAMACardProps) {
	return (
		<Link
			className="flex h-36 w-[80vw] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-on-secondary bg-card p-4 hover:border-misc-accent dark:border-on-secondary-dark dark:bg-card-dark md:w-52"
			href={`/dashboard/${guildId}/ama/amas/new`}
		>
			<SvgPlus />
			<span className="text-lg font-medium text-primary dark:text-primary-dark">Create AMA</span>
		</Link>
	);
}
