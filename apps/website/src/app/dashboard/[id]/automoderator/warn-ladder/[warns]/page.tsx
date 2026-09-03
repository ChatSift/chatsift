import { EditWarnPunishmentFormLoader } from '../_components/WarnPunishmentForm';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function EditWarnPunishmentPage() {
	return (
		<div className="space-y-8">
			<PageHeader subtitle="Edit a warn ladder step" title="Edit Step" />
			<EditWarnPunishmentFormLoader />
		</div>
	);
}
