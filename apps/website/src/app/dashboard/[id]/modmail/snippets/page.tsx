import { DashboardCrumbs } from '../../../_components/DashboardCrumbs';
import { SnippetsList } from './_components/SnippetsList';
import { Heading } from '@/components/common/Heading';

export default function ModmailSnippetsPage() {
	return (
		<>
			<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
				<DashboardCrumbs />
				<Heading subtitle="Quick canned responses staff can use in a ticket" title="ModMail Snippets" />
			</div>

			<div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
				<SnippetsList />
			</div>
		</>
	);
}
