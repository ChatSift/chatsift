import { PageSection } from '../_components/PageSection';
import { BypassRolesForm } from './_components/BypassRolesForm';
import { FilterExemptionsForm } from './_components/FilterExemptionsForm';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { PageHeader } from '@/components/dashboard/PageHeader';

/**
 * Who and where the filters leave alone -- formerly the separate `filter-exemptions` and `bypass-roles`
 * sections, which answered the same question about a channel and about a role and made you find both. Both old
 * URLs redirect here (see `next.config.mjs`).
 */
export default function AutomoderatorExemptionsPage() {
	return (
		<div className="space-y-8">
			<PageHeader
				action={<RefreshServerDataButton for_bot="AUTOMODERATOR" />}
				subtitle="Channels the filters skip, and roles they never punish"
				title="Exemptions"
			/>

			<PageSection title="Exempt channels">
				<FilterExemptionsForm />
			</PageSection>

			<PageSection title="Bypass roles">
				<BypassRolesForm />
			</PageSection>
		</div>
	);
}
