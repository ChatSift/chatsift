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
	// `@chatsift/web-core`'s `utils/og.tsx` reads the Author `.ttf`s off disk at request time to brand the
	// social card. Next's file tracer only follows static imports, so without this the fonts are left out of
	// the serverless bundle and every card silently renders in the fallback font. Same entry the dashboard
	// carries; the files themselves are synced in by `sync-web-core-assets.mjs`.
	outputFileTracingIncludes: {
		'/**/opengraph-image': ['./public/assets/fonts/Author-Regular.ttf', './public/assets/fonts/Author-Semibold.ttf'],
	},
	typescript: {
		ignoreBuildErrors: false,
	},
	reactCompiler: true,
};

export default nextConfig;
