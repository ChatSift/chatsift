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
		],
	},
	productionBrowserSourceMaps: true,
	logging: {
		fetches: {
			fullUrl: true,
		},
	},
	eslint: {
		ignoreDuringBuilds: true,
	},
	typescript: {
		ignoreBuildErrors: false,
	},
	experimental: {
		reactCompiler: true,
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
				source: '/invites/ama',
				destination:
					'https://discord.com/oauth2/authorize?client_id=1427232824854970409&permissions=274878024704&scope=applications.commands%20bot',
				permanent: true,
			},
		];
	},
};
