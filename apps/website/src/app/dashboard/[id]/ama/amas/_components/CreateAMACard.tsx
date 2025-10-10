'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { SvgPlus } from '@/components/icons/SvgPlus';

export function CreateAMACard() {
	const params = useParams<{ id: string }>();

	return (
		<Link
			className="flex h-36 w-[80vw] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-on-secondary bg-card p-4 hover:border-misc-accent dark:border-on-secondary-dark dark:bg-card-dark md:w-52"
			href={`/dashboard/${params.id}/ama/amas/new`}
		>
			<SvgPlus />
			<span className="text-lg font-medium text-primary dark:text-primary-dark">Create AMA</span>
		</Link>
	);
}
