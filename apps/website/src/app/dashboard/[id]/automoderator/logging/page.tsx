import { PageSection } from '../_components/PageSection';
import { LogChannelsForm } from './_components/LogChannelsForm';
import { LogExemptionsForm } from './_components/LogExemptionsForm';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { PageHeader } from '@/components/dashboard/PageHeader';

/**
 * Where logs go and what never reaches them, on one page -- the two used to be `log-channels` and
 * `log-exemptions`, listed as separate top-level sections despite the second being meaningless without the
 * first. Both old URLs redirect here (see `next.config.mjs`).
 */
export default function AutomoderatorLoggingPage() {
	return (
		<div className="space-y-8">
			<PageHeader
				action={<RefreshServerDataButton for_bot="AUTOMODERATOR" />}
				subtitle="Where moderation actions, message edits and profile changes are posted"
				title="Logging"
			/>

			<PageSection title="Log channels">
				<LogChannelsForm />
			</PageSection>

			<PageSection title="Ignored channels">
				<LogExemptionsForm />
			</PageSection>
		</div>
	);
}
