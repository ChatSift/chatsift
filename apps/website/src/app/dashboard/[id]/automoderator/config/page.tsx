import { AutomoderatorConfigForm } from './_components/AutomoderatorConfigForm';
import { Heading } from '@/components/common/Heading';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AutomoderatorConfigPage() {
	return (
		<div className="space-y-8">
			<div className="flex flex-col gap-4">
				<DashboardCrumbs />
				<Heading
					subtitle="Server-wide behavior, including whether actions are actually carried out"
					title="AutoModerator Config"
				/>
			</div>

			<AutomoderatorConfigForm />
		</div>
	);
}
