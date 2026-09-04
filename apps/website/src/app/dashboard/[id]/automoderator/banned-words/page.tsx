import { BannedWordsList } from './_components/BannedWordsList';
import { RefreshRulesButton } from './_components/RefreshRulesButton';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function AutomoderatorBannedWordsPage() {
	return (
		<div className="space-y-8">
			<PageHeader
				action={<RefreshRulesButton />}
				subtitle="What happens when Discord's AutoMod catches somebody"
				title="Banned Words"
			/>
			<BannedWordsList />
		</div>
	);
}
