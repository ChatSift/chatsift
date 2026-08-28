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
		segment: 'reports',
		title: 'Reports',
		subtitle: 'What members have flagged to your staff team',
	},
	{
		segment: 'banned-words',
		title: 'Banned Words',
		subtitle: "What happens when Discord's AutoMod catches somebody",
	},
	{
		segment: 'url-filter',
		title: 'URL Filter',
		subtitle: 'Which links members are allowed to post',
	},
	{
		segment: 'invite-filter',
		title: 'Invite Filter',
		subtitle: 'Which other servers members are allowed to link',
	},
	{
		segment: 'filter-exemptions',
		title: 'Filter Exemptions',
		subtitle: 'Channels the URL and invite filters leave alone',
	},
	{
		segment: 'bypass-roles',
		title: 'Bypass Roles',
		subtitle: 'Roles the filters never punish',
	},
	{
		segment: 'warn-ladder',
		title: 'Warn Ladder',
		subtitle: 'What happens as warnings pile up, and when they stop counting',
	},
	{
		segment: 'log-channels',
		title: 'Log Channels',
		subtitle: 'Where moderation actions, message edits and profile changes are posted',
	},
	{
		segment: 'log-exemptions',
		title: 'Log Exemptions',
		subtitle: 'Channels the message log leaves alone',
	},
	{
		segment: 'report-settings',
		title: 'Report Settings',
		subtitle: 'Where reports go, and the reasons reporters can pick from',
	},
	{
		segment: 'report-prompts',
		title: 'Report Prompts',
		subtitle: 'Messages telling members how to report DMs to this server',
	},
	{
		segment: 'config',
		title: 'Config',
		subtitle: 'Server-wide behavior, including whether actions are actually carried out',
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
