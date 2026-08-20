import { BannedWordsList } from './_components/BannedWordsList';
import { Heading } from '@/components/common/Heading';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AutomoderatorBannedWordsPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<DashboardCrumbs />
			<Heading subtitle="What happens when Discord's AutoMod catches somebody" title="Banned Words" />
			<BannedWordsList />
		</div>
	);
}
