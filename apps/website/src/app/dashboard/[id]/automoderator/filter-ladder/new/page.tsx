import { TriggerPunishmentForm } from '../_components/TriggerPunishmentForm';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function NewTriggerPunishmentPage() {
	return (
		<div className="space-y-8">
			<PageHeader subtitle="Act automatically once someone has tripped the filters this often" title="Add Step" />
			<TriggerPunishmentForm />
		</div>
	);
}
