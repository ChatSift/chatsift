import { SocialInertBanner } from '../_components/SocialInertBanner';
import { SocialRolesList } from './_components/SocialRolesList';
import { Heading } from '@/components/common/Heading';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function SocialRolesPage() {
	return (
		<>
			<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
				<DashboardCrumbs />
				<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
					<Heading subtitle="Roles that multiply the XP their holders earn" title="Social Roles" />
					<RefreshServerDataButton for_bot="SOCIAL" />
				</div>
				<SocialInertBanner />
			</div>

			<div className="mt-8 grid grid-cols-1 items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
				<SocialRolesList />
			</div>
		</>
	);
}
