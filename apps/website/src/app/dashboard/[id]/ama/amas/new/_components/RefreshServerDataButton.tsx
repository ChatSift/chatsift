'use client';

import type { BotId } from '@chatsift/core';
import { useParams } from 'next/navigation';
import { Button } from '@/components/common/Button';
import { SvgRefresh } from '@/components/icons/SvgRefresh';
import { client } from '@/data/client';

interface RefreshServerDataButtonProps {
	readonly for_bot: BotId;
}

export function RefreshServerDataButton({ for_bot }: RefreshServerDataButtonProps) {
	const params = useParams<{ id: string }>();
	const { id: guildId } = params;

	const { refetch, isLoading } = client.guilds.useInfo(guildId, { for_bot, force_fresh: 'true' });

	return (
		<Button
			className="border border-solid border-on-primary px-4 py-2 text-secondary dark:border-on-primary-dark dark:text-secondary-dark"
			isDisabled={isLoading}
			onPress={async () => {
				await refetch();
			}}
		>
			<SvgRefresh />
			Refresh Server Data
		</Button>
	);
}
