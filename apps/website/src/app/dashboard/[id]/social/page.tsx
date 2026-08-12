import Link from 'next/link';
import { SocialInertBanner } from './_components/SocialInertBanner';
import { Heading } from '@/components/common/Heading';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';
import { SvgSocial } from '@/components/icons/SvgSocial';

const SECTIONS = [
	{
		segment: 'config',
		title: 'Config',
		subtitle: 'XP gain, the level curve, and level-up notifications',
	},
	{
		segment: 'channels',
		title: 'Channels',
		subtitle: 'Channels that grant no XP, or grant it faster',
	},
	{
		segment: 'roles',
		title: 'Roles',
		subtitle: 'Roles that multiply the XP their holders earn',
	},
	{
		segment: 'rewards',
		title: 'Rewards',
		subtitle: 'Roles handed out when members reach a level',
	},
	{
		segment: 'interactions',
		title: 'Interactions',
		subtitle: 'Custom slash commands like /hug anyone can use',
	},
	{
		segment: 'leaderboard',
		title: 'Leaderboard',
		subtitle: "Leaderboard for your community's most active members, and the public page for it",
	},
] as const;

export default async function SocialPage({ params }: PageProps<'/dashboard/[id]/social'>) {
	const { id } = await params;

	return (
		<div className="space-y-8">
			<div className="flex flex-col gap-4">
				<DashboardCrumbs />
				<Heading subtitle="Configure Social for your server" title="Social Settings" />
				<SocialInertBanner />
				{SECTIONS.map(({ segment, title, subtitle }) => (
					<Link
						className="flex items-center gap-4 rounded-lg border-[1px] border-on-secondary bg-card p-4 hover:bg-on-tertiary dark:border-on-secondary-dark dark:bg-card-dark dark:hover:bg-on-tertiary-dark"
						href={`/dashboard/${id}/social/${segment}`}
						key={segment}
						prefetch
					>
						<div className="flex h-12 w-12 items-center justify-center rounded-lg bg-on-tertiary dark:bg-on-tertiary-dark">
							<SvgSocial height={28} width={28} />
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
