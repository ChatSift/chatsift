import { PunishmentNoticesForm } from './_components/PunishmentNoticesForm';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function AutomoderatorPunishmentNoticesPage() {
	return (
		<div className="space-y-8">
			<PageHeader subtitle="Text the bot appends at the end of punishment reasons" title="Punishment Notices" />
			<PunishmentNoticesForm />
		</div>
	);
}
