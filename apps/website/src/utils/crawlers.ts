/**
 * Link unfurlers -- the bots that fetch a URL purely to build a preview card when someone pastes it into a
 * chat or a post.
 *
 * Deliberately an allowlist of *unfurlers only*, with no general-purpose search crawler (Googlebot, Bingbot)
 * on it. This list is what `proxy.ts` uses to decide who may skip the dashboard's OAuth redirect (#295), and
 * "render a preview card" is the only reason to be granted that; indexing the dashboard is not (see
 * `app/robots.ts`).
 *
 * User agents are trivially spoofable, which is fine here and worth being explicit about: the redirect this
 * gates is a UX convenience, not the security boundary. Everything on a dashboard page is fetched
 * client-side against an authenticated API, so what a request with one of these user agents actually gets
 * back is the same empty shell any logged-out browser would render -- plus the route's metadata, which is
 * the entire point.
 */
const SOCIAL_CRAWLERS =
	/discordbot|twitterbot|slackbot|slack-imgproxy|facebookexternalhit|telegrambot|whatsapp|linkedinbot|mastodon|bluesky|redditbot|embedly|iframely/iu;

export function isSocialCrawler(userAgent: string | null): boolean {
	return userAgent !== null && SOCIAL_CRAWLERS.test(userAgent);
}
