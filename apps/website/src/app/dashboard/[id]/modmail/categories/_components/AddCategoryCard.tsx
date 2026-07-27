import Link from 'next/link';
import { SvgPlus } from '@/components/icons/SvgPlus';

interface AddCategoryCardProps {
	readonly guildId: string;
}

export function AddCategoryCard({ guildId }: AddCategoryCardProps) {
	return (
		<Link
			className="flex h-full min-h-36 w-full flex-col items-center justify-center gap-2 self-stretch rounded-lg border-2 border-dashed border-on-secondary bg-card p-4 hover:border-misc-accent dark:border-on-secondary-dark dark:bg-card-dark"
			href={`/dashboard/${guildId}/modmail/categories/new`}
		>
			<SvgPlus />
			<span className="text-lg font-medium text-primary dark:text-primary-dark">Add Category</span>
		</Link>
	);
}
