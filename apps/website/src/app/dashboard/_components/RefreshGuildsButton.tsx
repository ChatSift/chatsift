'use client';

import { useRefreshMe } from '@/api/routes/auth';
import { Button } from '@/components/common/Button';
import { SvgRefresh } from '@/components/icons/SvgRefresh';

export function RefreshGuildsButton() {
	const { mutateAsync: refreshMe, isPending } = useRefreshMe();

	return (
		<Button
			className="border border-solid border-on-primary px-4 py-2 text-secondary dark:border-on-primary-dark dark:text-secondary-dark"
			isDisabled={isPending}
			onPress={async () => {
				await refreshMe();
			}}
		>
			<SvgRefresh />
			Refresh
		</Button>
	);
}
