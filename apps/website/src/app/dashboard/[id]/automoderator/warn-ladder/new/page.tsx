import { WarnPunishmentForm } from '../_components/WarnPunishmentForm';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function NewWarnPunishmentPage() {
	return (
		<div className="space-y-8">
			<PageHeader subtitle="Act automatically once someone has collected this many warnings" title="Add Step" />
			<WarnPunishmentForm />
		</div>
	);
}
