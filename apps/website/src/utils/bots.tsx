import type { BotId } from '@chatsift/core';
import Image from 'next/image';
import { SvgAMA } from '@/components/icons/SvgAMA';
import { SvgAutoModerator } from '@/components/icons/SvgAutoModerator';
import { SvgModmail } from '@/components/icons/SvgModmail';
import { SvgSocial } from '@/components/icons/SvgSocial';

// Every `BotId` needs an entry here, including one with no public marketing page yet (SOCIAL, #343) -- this
// is the *dashboard's* branding, and a guild the bot is actually in gets a nav tab from it (`GuildNav.tsx`)
// regardless of whether the product has been announced. `data/marketingBots.ts` is the public-facing half,
// and that one is deliberately partial.
export const Bots = {
	AMA: { Icon: SvgAMA, label: 'AMA' },
	MODMAIL: { Icon: SvgModmail, label: 'ModMail' },
	SOCIAL: { Icon: SvgSocial, label: 'Social' },
	AUTOMODERATOR: { Icon: SvgAutoModerator, label: 'AutoModerator' },
} as const satisfies Record<BotId, { Icon: React.ComponentType<{ height?: number; width?: number }>; label: string }>;

export interface BotBrandingSource {
	readonly customInstanceIconUrl: string | null;
	readonly customInstanceId: string | null;
	readonly customInstanceLabel: string | null;
}

export interface BotBranding {
	readonly iconUrl: string | null;
	/**
	 * Whether this resolved to a partner's own ModMail application rather than the public bot. Callers that
	 * phrase copy differently for a custom instance read this instead of re-deriving
	 * `bot === 'MODMAIL' && guild.customInstanceId`, which is the same condition this function already owns.
	 */
	readonly isCustomInstance: boolean;
	readonly label: string;
}

/**
 * Only MODMAIL can be a custom instance (#216) -- AMA, and any guild with no `modmail_instances` row, always
 * resolve to the static `Bots[bot]` entry, rendering byte-identically to before P3.
 */
export function resolveBotBranding(guild: BotBrandingSource, bot: BotId): BotBranding {
	if (bot === 'MODMAIL' && guild.customInstanceId) {
		return {
			label: guild.customInstanceLabel ?? Bots.MODMAIL.label,
			iconUrl: guild.customInstanceIconUrl,
			isCustomInstance: true,
		};
	}

	return { label: Bots[bot].label, iconUrl: null, isCustomInstance: false };
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
