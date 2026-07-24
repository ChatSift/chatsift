import { DashboardCrumbs } from '../../../_components/DashboardCrumbs';
import { ModmailConfigForm } from './_components/ModmailConfigForm';
import { Heading } from '@/components/common/Heading';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';

export default function ModmailConfigPage() {
	return (
		<div className="space-y-8">
			<div className="flex flex-col gap-4">
				<DashboardCrumbs />
				<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
					<Heading subtitle="Mod forum, greeting/farewell messages, and alert role" title="ModMail Config" />
					<RefreshServerDataButton for_bot="MODMAIL" />
				</div>
			</div>

			<ModmailConfigForm />
		</div>
	);
}
