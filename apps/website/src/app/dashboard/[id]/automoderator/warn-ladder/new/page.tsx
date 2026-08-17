import { WarnPunishmentForm } from '../_components/WarnPunishmentForm';
import { Heading } from '@/components/common/Heading';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function NewWarnPunishmentPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<DashboardCrumbs />
			<Heading subtitle="Act automatically once someone reaches a number of warnings" title="Add Step" />
			<WarnPunishmentForm />
		</div>
	);
}
