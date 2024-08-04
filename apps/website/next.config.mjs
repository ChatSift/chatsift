/**
 * @type {import('next').NextConfig}
 */
export default {
	reactStrictMode: true,
	images: {
		dangerouslyAllowSVG: true,
		contentDispositionType: 'attachment',
		contentSecurityPolicy: "default-src 'self'; frame-src 'none'; sandbox;",
		remotePatterns: [
			{
				protocol: 'https',
				hostname: 'cdn.discordapp.com',
				pathname: '/icons/**',
			},
		],
	},
	productionBrowserSourceMaps: true,
	logging: {
		fetches: {
			fullUrl: true,
		},
	},
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
				source: '/invites/automoderator',
				destination:
					'https://discord.com/api/oauth2/authorize?client_id=847081327950168104&permissions=1100451531910&scope=applications.commands%20bot',
				permanent: true,
			},
		];
	},
};
