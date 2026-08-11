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
					'https://discord.com/oauth2/authorize?client_id=1427232824854970409&permissions=274878024704&scope=applications.commands%20bot',
				permanent: true,
			},
			{
				source: '/invites/modmail',
				destination:
					'https://discord.com/oauth2/authorize?client_id=1530137759304515647&permissions=360777370624&scope=applications.commands%20bot',
				permanent: true,
			},
			{
				source: '/kofi',
				destination: 'https://ko-fi.com/chatsift',
				permanent: true,
			},
		];
	},
};
