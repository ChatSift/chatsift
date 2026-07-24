import type { BotId } from '@chatsift/core';
import { SvgAMA } from '@/components/icons/SvgAMA';
import { SvgModmail } from '@/components/icons/SvgModmail';

export const Bots = {
	AMA: { Icon: SvgAMA, label: 'AMA' },
	MODMAIL: { Icon: SvgModmail, label: 'ModMail' },
} as const satisfies Record<BotId, { Icon: React.ComponentType; label: string }>;
