/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,
	// Same reason as `apps/website`: `@chatsift/web-core` ships raw TS/TSX rather than a build, so Next compiles
	// each of its modules individually, which is what keeps every file's own `'use client'` boundary intact.
	transpilePackages: ['@chatsift/web-core'],
	images: {
		contentDispositionType: 'attachment',
		contentSecurityPolicy: "default-src 'self'; frame-src 'none'; sandbox;",
		remotePatterns: [
			{
				// Guild icons, so an appellant can see which server they are about to appeal to. No app-icons
				// pattern here, unlike the dashboard's: custom instances are a ModMail-only concept and #232's
				// decision 11 keeps Appeals out of them deliberately.
				protocol: 'https',
				hostname: 'cdn.discordapp.com',
				pathname: '/icons/**',
			},
			{
				protocol: 'https',
				hostname: 'cdn.discordapp.com',
				pathname: '/avatars/**',
			},
			{
				protocol: 'https',
				hostname: 'cdn.discordapp.com',
				pathname: '/embed/avatars/**',
			},
		],
	},
	typescript: {
		ignoreBuildErrors: false,
	},
	reactCompiler: true,
};

export default nextConfig;
