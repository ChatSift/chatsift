import type { BotId } from '@chatsift/core';
import { SvgAMA } from '@/components/icons/SvgAMA';

export const Bots = {
	AMA: { Icon: SvgAMA },
} as const satisfies Record<BotId, { Icon: React.ComponentType }>;
