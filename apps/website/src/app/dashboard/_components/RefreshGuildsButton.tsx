'use client';

import { Button } from '@/components/common/Button';
import { SvgRefresh } from '@/components/icons/SvgRefresh';
import { client } from '@/data/client';

export function RefreshGuildsButton() {
	const { refetch, isLoading } = client.auth.useMe({ force_fresh: true });

	return (
		<Button
			className="border border-solid border-on-primary px-4 py-2 text-secondary dark:border-on-primary-dark dark:text-secondary-dark"
			isDisabled={isLoading}
			onPress={async () => {
				await refetch();
			}}
		>
			<SvgRefresh />
			Refresh
		</Button>
	);
}
