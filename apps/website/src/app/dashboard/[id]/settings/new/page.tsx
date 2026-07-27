import { CreateGrantForm } from './_components/CreateGrantForm';
import { Heading } from '@/components/common/Heading';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function NewGrantPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<DashboardCrumbs />
			<Heading subtitle="Grant a user access to this server's dashboard" title="New Grant" />
			<CreateGrantForm />
		</div>
	);
}
