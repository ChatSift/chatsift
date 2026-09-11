import { Heading } from '@chatsift/web-core/components/Heading';
import Link from 'next/link';
import { SocialInertBanner } from './_components/SocialInertBanner';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';
import { SvgSocial } from '@/components/icons/SvgSocial';
import { SOCIAL_SECTION_LIST } from '@/utils/socialSections';

export default async function SocialPage({ params }: PageProps<'/dashboard/[id]/social'>) {
	const { id } = await params;

	return (
		<div className="space-y-8">
			<div className="flex flex-col gap-4">
				<DashboardCrumbs />
				<Heading subtitle="Configure Social for your server" title="Social Settings" />
				<SocialInertBanner />
				{SOCIAL_SECTION_LIST.map(({ segment, title, subtitle }) => (
					<Link
						className="flex items-center gap-4 rounded-lg border-[1px] border-on-secondary bg-card p-4 hover:bg-on-tertiary dark:border-on-secondary-dark dark:bg-card-dark dark:hover:bg-on-tertiary-dark"
						href={`/dashboard/${id}/social/${segment}`}
						key={segment}
						prefetch
					>
						<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-on-tertiary dark:bg-on-tertiary-dark">
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
