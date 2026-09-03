import { UrlFilterForm } from './_components/UrlFilterForm';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function AutomoderatorUrlFilterPage() {
	return (
		<div className="space-y-8">
			<PageHeader
				action={<RefreshServerDataButton for_bot="AUTOMODERATOR" />}
				subtitle="Which links members are allowed to post"
				title="URL Filter"
			/>
			<UrlFilterForm />
		</div>
	);
}
