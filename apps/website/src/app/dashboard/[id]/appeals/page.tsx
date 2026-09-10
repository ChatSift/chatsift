import { Heading } from '@chatsift/web-core/components/Heading';
import Link from 'next/link';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';
import { SvgAppeals } from '@/components/icons/SvgAppeals';
import { APPEALS_SECTION_LIST } from '@/utils/appealsSections';

export default async function AppealsPage({ params }: PageProps<'/dashboard/[id]/appeals'>) {
	const { id } = await params;

	return (
		<div className="space-y-8">
			<div className="flex flex-col gap-4">
				<DashboardCrumbs />
				<Heading subtitle="Configure Appeals for your server" title="Appeals Settings" />
				{APPEALS_SECTION_LIST.map(({ segment, title, subtitle }) => (
					<Link
						className="flex items-center gap-4 rounded-lg border-[1px] border-on-secondary bg-card p-4 hover:bg-on-tertiary dark:border-on-secondary-dark dark:bg-card-dark dark:hover:bg-on-tertiary-dark"
						href={`/dashboard/${id}/appeals/${segment}`}
						key={segment}
						prefetch
					>
						<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-on-tertiary dark:bg-on-tertiary-dark">
							<SvgAppeals height={28} width={28} />
						</div>
						<div className="flex flex-col">
							<p className="text-lg font-medium text-primary dark:text-primary-dark">{title}</p>
							<p className="text-sm text-secondary dark:text-secondary-dark">{subtitle}</p>
						</div>
					</Link>
				))}
			</div>
		</div>
	);
}
