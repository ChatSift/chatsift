/** @type {import('next').NextConfig} */
export default {
	reactStrictMode: true,
	images: {
		contentDispositionType: 'attachment',
		contentSecurityPolicy: "default-src 'self'; frame-src 'none'; sandbox;",
		remotePatterns: [
			{
				protocol: 'https',
				hostname: 'cdn.discordapp.com',
				pathname: '/icons/**',
			},
			{
				// Custom ModMail instance branding (#216 P3) -- a bot application's own icon, distinct from a
				// guild icon above.
				protocol: 'https',
				hostname: 'cdn.discordapp.com',
				pathname: '/app-icons/**',
			},
		],
	},
	productionBrowserSourceMaps: true,
	// `utils/og.tsx` reads the Author `.ttf`s off disk at request time to brand the social cards (#295).
	// Next's file tracer only follows static imports, so without this the fonts are left out of the
	// serverless bundle and every card silently renders in the fallback font.
	outputFileTracingIncludes: {
		'/**/opengraph-image': ['./public/assets/fonts/Author-Regular.ttf', './public/assets/fonts/Author-Semibold.ttf'],
	},
	logging: {
		fetches: {
			fullUrl: true,
		},
	},
	typescript: {
		ignoreBuildErrors: false,
	},
	reactCompiler: true,
	async redirects() {
		return [
			{
				source: '/github',
				destination: 'https://github.com/chatsift',
				permanent: true,
			},
			{
				source: '/support',
				destination: 'https://discord.gg/tgZ2pSgXXv',
				permanent: true,
			},
			{
				source: '/invites/ama',
				destination:
					'https://discord.com/oauth2/authorize?client_id=872022469081448489&permissions=274878024704&scope=applications.commands%20bot',
				permanent: false,
			},
			{
				// #159 cutover: repointed from the v3-only application (1530137759304515647) to the legacy
				// public ModMail application, whose token `modmail-bot` adopts at cutover -- 2460 guilds keep
				// their existing install, and a fresh invite has to land on that same application or the new
				// guild gets a bot nobody is running. Now `permanent: false` like `/invites/ama` above: the
				// 308 this used to serve is cached by the browser indefinitely, which is precisely the wrong
				// property for a link whose target just moved once and could move again.
				source: '/invites/modmail',
				destination:
					'https://discord.com/oauth2/authorize?client_id=981971797480210523&permissions=360777370624&scope=applications.commands%20bot',
				permanent: false,
			},
			{
				source: '/kofi',
				destination: 'https://ko-fi.com/chatsift',
				permanent: true,
			},
			// The AutoModerator dashboard's sections were regrouped and four of them merged into two pages. These
			// keep bookmarks and any link already handed to a server's staff working. `permanent: false` on
			// purpose -- a 308 is cached by the browser forever, and the sections these point at are still being
			// rearranged.
			...['log-channels', 'log-exemptions'].map((section) => ({
				source: `/dashboard/:guildId/automoderator/${section}`,
				destination: '/dashboard/:guildId/automoderator/logging',
				permanent: false,
			})),
			...['filter-exemptions', 'bypass-roles'].map((section) => ({
				source: `/dashboard/:guildId/automoderator/${section}`,
				destination: '/dashboard/:guildId/automoderator/exemptions',
				permanent: false,
			})),
			{
				// Enforcement is the only thing this page ever held, and it sits on the hub now.
				source: '/dashboard/:guildId/automoderator/config',
				destination: '/dashboard/:guildId/automoderator',
				permanent: false,
			},
		];
	},
};
