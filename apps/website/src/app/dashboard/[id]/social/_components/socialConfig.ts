import type { SocialConfig } from '@/api/routes/social';

/**
 * The bot's own "is this guild configured at all" gate, mirrored from `services/social-bot`'s `isConfigured`:
 * until all three are set nothing is tracked, no matter what else on the config page is filled in. The dashboard
 * surfaces that state explicitly (`SocialInertBanner`) rather than letting a server look configured while
 * silently granting nobody any XP.
 */
export function isTrackingConfigured(config: SocialConfig): boolean {
	return config.requiredMessages !== null && config.requiredMessagesTimespan !== null && config.xpGain !== null;
}

/**
 * What the config form prefills a never-configured guild with, so switching tracking on is one click rather than
 * five guesses. Every value sits inside the API's own bounds (see `@chatsift/api/social-schemas`), and none of
 * this is written anywhere until the form is actually saved.
 *
 * The curve pair is the worked example the formula's derivation uses -- level 1 at 100 XP, each level after
 * costing 50 more than the last.
 */
export const SOCIAL_CONFIG_DEFAULTS = {
	requiredMessages: 3,
	requiredMessagesTimespan: 30,
	xpGain: 10,
	requiredXpBase: 100,
	requiredXpMultiplier: 50,
} as const;
