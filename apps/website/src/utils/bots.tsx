import type { BotId } from '@chatsift/core';
import Image from 'next/image';
import { SvgAMA } from '@/components/icons/SvgAMA';
import { SvgModmail } from '@/components/icons/SvgModmail';

export const Bots = {
	AMA: { Icon: SvgAMA, label: 'AMA' },
	MODMAIL: { Icon: SvgModmail, label: 'ModMail' },
} as const satisfies Record<BotId, { Icon: React.ComponentType<{ height?: number; width?: number }>; label: string }>;

export interface BotBrandingSource {
	readonly customInstanceIconUrl: string | null;
	readonly customInstanceId: string | null;
	readonly customInstanceLabel: string | null;
}

export interface BotBranding {
	readonly iconUrl: string | null;
	readonly label: string;
}

/**
 * Only MODMAIL can be a custom instance (#216) -- AMA, and any guild with no `modmail_instances` row, always
 * resolve to the static `Bots[bot]` entry, rendering byte-identically to before P3.
 */
export function resolveBotBranding(guild: BotBrandingSource, bot: BotId): BotBranding {
	if (bot === 'MODMAIL' && guild.customInstanceId) {
		return { label: guild.customInstanceLabel ?? Bots.MODMAIL.label, iconUrl: guild.customInstanceIconUrl };
	}

	return { label: Bots[bot].label, iconUrl: null };
}

export interface BotIconProps {
	readonly bot: BotId;
	readonly branding: BotBranding;
	readonly height?: number;
	readonly width?: number;
}

/**
 * Renders a custom instance's CDN avatar when `branding` resolved one, else the bot's static SVG.
 */
export function BotIcon({ bot, branding, height = 24, width = 24 }: BotIconProps) {
	if (branding.iconUrl) {
		return <Image alt={branding.label} className="rounded-full" height={height} src={branding.iconUrl} width={width} />;
	}

	const { Icon } = Bots[bot];
	return <Icon height={height} width={width} />;
}
