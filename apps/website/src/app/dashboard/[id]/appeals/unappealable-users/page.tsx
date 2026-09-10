import { Heading } from '@chatsift/web-core/components/Heading';
import { UnappealableUsersSection } from './_components/UnappealableUsersSection';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AppealsUnappealableUsersPage() {
	return (
		<div className="space-y-8">
			<div className="flex flex-col gap-4">
				<DashboardCrumbs />
				<Heading subtitle="Accounts that may never appeal a ban in this server" title="Unappealable Users" />
			</div>

			<UnappealableUsersSection />
		</div>
	);
}
