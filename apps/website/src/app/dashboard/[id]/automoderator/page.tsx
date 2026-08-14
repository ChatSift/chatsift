import Link from 'next/link';
import { Heading } from '@/components/common/Heading';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';
import { SvgAutoModerator } from '@/components/icons/SvgAutoModerator';

const SECTIONS = [
	{
		segment: 'cases',
		title: 'Cases',
		subtitle: 'Every moderation action taken in this server, and who took it',
	},
	{
		segment: 'log-channels',
		title: 'Log Channels',
		subtitle: 'Where moderation actions are posted',
	},
	{
		segment: 'config',
		title: 'Config',
		subtitle: 'Server-wide behaviour, including whether actions are actually carried out',
	},
] as const;

export default async function AutomoderatorPage({ params }: PageProps<'/dashboard/[id]/automoderator'>) {
	const { id } = await params;

	return (
		<div className="space-y-8">
			<div className="flex flex-col gap-4">
				<DashboardCrumbs />
				<Heading subtitle="Configure AutoModerator for your server" title="AutoModerator Settings" />
				{SECTIONS.map(({ segment, title, subtitle }) => (
					<Link
						className="flex items-center gap-4 rounded-lg border-[1px] border-on-secondary bg-card p-4 hover:bg-on-tertiary dark:border-on-secondary-dark dark:bg-card-dark dark:hover:bg-on-tertiary-dark"
						href={`/dashboard/${id}/automoderator/${segment}`}
						key={segment}
						prefetch
					>
						<div className="flex h-12 w-12 items-center justify-center rounded-lg bg-on-tertiary dark:bg-on-tertiary-dark">
							<SvgAutoModerator height={28} width={28} />
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
