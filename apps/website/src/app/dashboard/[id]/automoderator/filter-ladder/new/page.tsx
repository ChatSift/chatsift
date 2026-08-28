import { TriggerPunishmentForm } from '../_components/TriggerPunishmentForm';
import { Heading } from '@/components/common/Heading';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function NewTriggerPunishmentPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<DashboardCrumbs />
			<Heading subtitle="Act automatically once someone has tripped the filters this often" title="Add Step" />
			<TriggerPunishmentForm />
		</div>
	);
}
