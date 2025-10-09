import { DashboardCrumbs } from '../../_components/DashboardCrumbs';

export default function AMAPage() {
	return (
		<div className="space-y-8">
			<div className="space-y-2">
				<DashboardCrumbs segments={[{ label: 'AMA', href: '/dashboard/[id]/ama' }]} />
			</div>

			<div className="grid gap-6 lg:grid-cols-2">
				<div className="space-y-6">
					{/* <OrgAvatarSection /> */}
					{/* <OrgInfoSection /> */}
				</div>

				<div className="space-y-6">{/* <OrgAdminsSection /> */}</div>
			</div>
		</div>
	);
}
