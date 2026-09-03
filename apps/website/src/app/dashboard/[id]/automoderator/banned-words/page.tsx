import { BannedWordsList } from './_components/BannedWordsList';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function AutomoderatorBannedWordsPage() {
	return (
		<div className="space-y-8">
			<PageHeader subtitle="What happens when Discord's AutoMod catches somebody" title="Banned Words" />
			<BannedWordsList />
		</div>
	);
}
