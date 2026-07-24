import Link from 'next/link';
import { DashboardCrumbs } from '../../_components/DashboardCrumbs';
import { Heading } from '@/components/common/Heading';
import { SvgModmail } from '@/components/icons/SvgModmail';

export default async function ModmailPage({ params }: PageProps<'/dashboard/[id]/modmail'>) {
	const { id } = await params;

	return (
		<div className="space-y-8">
			<div className="flex flex-col gap-4">
				<DashboardCrumbs />
				<Heading subtitle="Configure ModMail for your server" title="ModMail Settings" />
				<Link
					className="flex items-center gap-4 rounded-lg border-[1px] border-on-secondary bg-card p-4 hover:bg-on-tertiary dark:border-on-secondary-dark dark:bg-card-dark dark:hover:bg-on-tertiary-dark"
					href={`/dashboard/${id}/modmail/config`}
					prefetch
				>
					<div className="flex h-12 w-12 items-center justify-center rounded-lg bg-on-tertiary dark:bg-on-tertiary-dark">
						<SvgModmail height={28} width={28} />
					</div>
					<div className="flex flex-col">
						<p className="text-lg font-medium text-primary dark:text-primary-dark">Config</p>
						<p className="text-sm text-secondary dark:text-secondary-dark">
							Mod forum, greeting/farewell messages, and alert role
						</p>
					</div>
				</Link>
			</div>
		</div>
	);
}
