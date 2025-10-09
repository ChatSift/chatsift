'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { DashboardCrumbs } from '../../_components/DashboardCrumbs';
import { Heading } from '@/components/common/Heading';

export default function AMAPage() {
	const params = useParams<{ id: string }>();

	return (
		<div className="space-y-8">
			<div className="space-y-4">
				<DashboardCrumbs segments={[{ label: 'AMA' }]} />
				<Heading subtitle="Configure AMA bot for your server" title="AMA Settings" />
			</div>

			<div className="flex flex-col gap-3">
				<Link
					className="flex items-center gap-4 rounded-lg border-[1px] border-on-secondary bg-card p-4 hover:bg-on-tertiary dark:border-on-secondary-dark dark:bg-card-dark dark:hover:bg-on-tertiary-dark"
					href={`/dashboard/${params.id}/ama/amas`}
					prefetch
				>
					<div className="flex h-12 w-12 items-center justify-center rounded-lg bg-misc-accent text-2xl font-bold text-primary-dark">
						Q
					</div>
					<div className="flex flex-col">
						<p className="text-lg font-medium text-primary dark:text-primary-dark">Manage AMAs</p>
						<p className="text-sm text-secondary dark:text-secondary-dark">
							Create, edit, and manage AMAs in your community
						</p>
					</div>
				</Link>
			</div>
		</div>
	);
}
