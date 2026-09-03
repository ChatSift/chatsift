import { AntiSpamForm } from './_components/AntiSpamForm';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function AutomoderatorAntiSpamPage() {
	return (
		<div className="space-y-8">
			<PageHeader subtitle="How many messages, how quickly, before it counts as spam" title="Anti-Spam" />
			<AntiSpamForm />
		</div>
	);
}
