'use client';

import { useState } from 'react';
import Button from '~/components/common/Button';
import SvgRefresh from '~/components/svg/SvgRefresh';
import { client } from '~/data/client';
import { useToast } from '~/hooks/useToast';

export default function RefreshGuildsButton() {
	const { refetch, isLoading } = client.useMe();
	const { toast, dismiss } = useToast();
	const [lastToastId, setLastToastId] = useState<string | null>(null);

	return (
		<Button
			className="border border-solid border-on-primary px-4 py-2 text-secondary"
			isDisabled={isLoading}
			onPress={async () => {
				await refetch();

				if (lastToastId) {
					dismiss(lastToastId);
				}

				const toasted = toast({
					title: 'Guilds refreshed',
					description: 'Your guilds have been successfully refreshed.',
				});

				setLastToastId(toasted.id);
			}}
		>
			<SvgRefresh />
			Refresh
		</Button>
	);
}
