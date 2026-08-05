import type { BotId } from '@chatsift/core';
import Link from 'next/link';
import { Bots } from '@/utils/bots';

interface BotCardProps {
	readonly bot: BotId;
	readonly cardDescription: string;
}

export function BotCard({ bot, cardDescription }: BotCardProps) {
	const { Icon, label } = Bots[bot];

	return (
		<Link
			className="flex h-full flex-col gap-3 rounded-lg border border-on-secondary bg-card p-5 hover:bg-on-tertiary dark:border-on-secondary-dark dark:bg-card-dark dark:hover:bg-on-tertiary-dark"
			href={`/bot/${bot.toLowerCase()}`}
			prefetch
		>
			<div className="flex items-center gap-2 text-xl font-medium text-primary dark:text-primary-dark">
				<Icon height={32} width={32} />
				{label}
			</div>
			<p className="max-w-[85%] text-base text-secondary dark:text-secondary-dark">{cardDescription}</p>
		</Link>
	);
}
