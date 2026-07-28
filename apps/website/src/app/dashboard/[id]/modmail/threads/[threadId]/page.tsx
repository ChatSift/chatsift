import { ThreadDetail } from './_components/ThreadDetail';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function ModmailThreadDetailPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<DashboardCrumbs />
			<ThreadDetail />
		</div>
	);
}
