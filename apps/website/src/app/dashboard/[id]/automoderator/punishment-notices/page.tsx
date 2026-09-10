import { PunishmentNoticesForm } from './_components/PunishmentNoticesForm';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function AutomoderatorPunishmentNoticesPage() {
	return (
		<div className="space-y-8">
			<PageHeader
				subtitle="What the bot tells somebody when it punishes them, and where they can appeal"
				title="Punishment Notices"
			/>
			<PunishmentNoticesForm />
		</div>
	);
}
