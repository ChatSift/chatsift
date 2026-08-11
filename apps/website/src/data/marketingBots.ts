import type { BotId } from '@chatsift/core';

/**
 * The bots with public marketing copy -- a deliberate subset of `BOTS`, not a mirror of it. A product becomes
 * a real `BotId` (and gets a dashboard nav tab in the guilds it's installed in) well before it's announced:
 * SOCIAL (#343) is a `BotId` from its API phase onward, months ahead of any public page. Everything public --
 * the homepage grid, `/bot/[name]` and its OG image, the cross-links between bot pages -- iterates *this*,
 * so adding a bot to `BOTS` never publishes anything on its own. Move an id here (with its entry below) when
 * the product actually launches.
 */
export const MARKETED_BOTS = ['AMA', 'MODMAIL'] as const satisfies readonly BotId[];

export type MarketedBotId = (typeof MARKETED_BOTS)[number];

/**
 * Resolves the lowercased `/bot/[name]` segment back to its `BotId`. Lives here rather than in the page so
 * the route's `opengraph-image` can share it -- both need to turn the same param into the same
 * `marketingBots` entry. An unmarketed bot's slug resolves to `undefined` exactly like an unknown one, so
 * `/bot/social` 404s until Social is launched rather than rendering a half-empty page.
 */
export function resolveBot(name: string): MarketedBotId | undefined {
	return MARKETED_BOTS.find((bot) => bot.toLowerCase() === name);
}

export interface MarketingScreenshot {
	readonly alt: string;
	readonly src: string;
}

export interface MarketingFeature {
	readonly description: string;
	readonly name: string;
}

export interface MarketingBot {
	/**
	 * Blurb shown on the homepage's bot card.
	 */
	readonly cardDescription: string;
	readonly features: {
		readonly items: readonly [MarketingFeature, MarketingFeature, ...MarketingFeature[]];
		readonly text: string;
		readonly title: string;
	};
	/**
	 * Blurb shown promoting this bot from *another* bot's page.
	 */
	readonly otherBotUpsell: string;
	readonly pageDescription: readonly [string, ...string[]];
	readonly pageTitle: string;
	/**
	 * Left empty until real screenshots on the current Discord client are captured -- see #262. `ScreenshotGallery`
	 * renders a placeholder when this is empty, so shipping with none isn't a build-time blocker.
	 */
	readonly screenshots: readonly MarketingScreenshot[];
}

export const marketingBots: Record<MarketedBotId, MarketingBot> = {
	AMA: {
		pageTitle: 'AMA (Ask Me Anything)',
		cardDescription: 'Manage and coordinate your Ask-Me-Anything events with ease.',
		pageDescription: [
			'Sift through community questions with a simple question feed ahead of time instead of picking them out from a live chat on the fly.',
		],
		otherBotUpsell:
			"Host and promote your community AMA's with organized workflows and promotional embeds for members.",
		features: {
			title: 'Core Features',
			text: "Enhance your community AMA's with a robust workflow to handle question moderation and selection.",
			items: [
				{
					name: 'Maintain confidentiality',
					description:
						'Review, moderate, and select community questions in private before anything reaches the public answers channel.',
				},
				{
					name: 'Event prompt',
					description:
						'Post an embed with a "Submit a question" button members can use to send in questions, image attachments included.',
				},
				{
					name: 'Moderation queue',
					description: 'Approve, deny, or flag incoming questions from a private mod queue before they go any further.',
				},
				{
					name: 'Guest queue',
					description:
						'Let hosts or guests privately pick which approved question gets answered next, right from Discord.',
				},
				{
					name: 'Stats & export',
					description: 'Track question counts by state on the dashboard and export a full CSV once your AMA wraps up.',
				},
			],
		},
		screenshots: [],
	},
	MODMAIL: {
		pageTitle: 'ModMail',
		cardDescription: 'Receive and respond to user inquiries with an easy to use workflow.',
		pageDescription: [
			"Support your community with a ticket-based modmail bot that's quick to set up and easy for both members and staff to use.",
		],
		otherBotUpsell: 'Give your community fast, organized support with a ticket-based modmail workflow.',
		features: {
			title: 'Core Features',
			text: "We've made sure to seamlessly tie together every essential tool needed so your staff can do their job with ease.",
			items: [
				{
					name: 'Maintain confidentiality',
					description:
						"Every conversation happens in a private thread on the member's side and a matching staff-only forum post on yours.",
				},
				{
					name: 'Sort inquiries by tags',
					description: 'Use forum tags to route incoming tickets into categories before staff ever see them.',
				},
				{
					name: 'Save time with snippets',
					description:
						'Save common replies as snippets you can fire off instantly, each becoming its own slash command.',
				},
				{
					name: 'Greetings and farewells',
					description: 'Automatically greet members when a ticket opens and send a farewell once it closes.',
				},
				{
					name: 'Minimize delays with alerts',
					description:
						'Subscribe to a ticket to get pinged on new replies, batched so a flurry of messages never turns into a flurry of pings.',
				},
				{
					name: 'Full thread history',
					description:
						'Opt in to a searchable, Discord-accurate transcript of every ticket right on the dashboard, edit history included.',
				},
			],
		},
		screenshots: [],
	},
};
