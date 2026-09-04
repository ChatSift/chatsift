import Link from 'next/link';
import { PageSection } from './_components/PageSection';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { SvgAutoModerator } from '@/components/icons/SvgAutoModerator';
import { AUTOMODERATOR_SECTION_GROUPS } from '@/utils/automoderatorSections';

export default async function AutomoderatorPage({ params }: PageProps<'/dashboard/[id]/automoderator'>) {
	const { id } = await params;

	return (
		<div className="space-y-8">
			<PageHeader subtitle="Configure AutoModerator for your server" title="AutoModerator Settings" />

			{AUTOMODERATOR_SECTION_GROUPS.map((group) => (
				<PageSection key={group.title} title={group.title}>
					<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
						{group.sections.map(({ segment, title, subtitle }) => (
							<Link
								className="flex items-center gap-4 rounded-lg border-[1px] border-on-secondary bg-card p-4 hover:bg-on-tertiary dark:border-on-secondary-dark dark:bg-card-dark dark:hover:bg-on-tertiary-dark"
								href={`/dashboard/${id}/automoderator/${segment}`}
								key={segment}
								prefetch
							>
								<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-on-tertiary dark:bg-on-tertiary-dark">
									<SvgAutoModerator height={28} width={28} />
								</div>
								<div className="flex flex-col">
									<p className="text-lg font-medium text-primary dark:text-primary-dark">{title}</p>
									<p className="text-sm text-secondary dark:text-secondary-dark">{subtitle}</p>
								</div>
							</Link>
						))}
					</div>
				</PageSection>
			))}
		</div>
	);
}
