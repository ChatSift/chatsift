import { withSentryConfig } from '@sentry/nextjs';

/**
 * Whether this build has somewhere private to put its source maps (#386). Set only on Vercel's Production
 * environment; absent locally, in CI, and on PR previews, where there is nothing to upload to and generating
 * maps would only risk publishing them.
 */
const hasUploadToken = Boolean(process.env.SENTRY_AUTH_TOKEN);

/** @type {import('next').NextConfig} */
const nextConfig = {
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
	// #386. `productionBrowserSourceMaps` used to live here, set to `true`, and its absence now is the fix --
	// but the key must be ABSENT rather than `false`, which is load-bearing and entirely counter-intuitive.
	//
	// `withSentryConfig`'s `maybeEnableTurbopackSourcemaps` bails out the moment it sees this key defined at
	// all, whatever its value. Under Turbopack the SDK has no webpack `devtool` to override, so Next's own
	// flag is the only thing that makes browser maps exist. Setting it `false` therefore means no maps are
	// generated, nothing is uploaded, and every stack stays minified forever -- silently. Setting it `true` is
	// wrong the other way: that also trips the bail-out, which skips the automatic
	// `deleteSourcemapsAfterUpload`, so the maps get uploaded AND go on being served publicly, which is #386
	// unfixed while looking fixed. Only leaving it undefined gets both halves.
	//
	// Verified locally against 16.2.10: with a token, `.next/static` ends up with zero `.map` files and zero
	// `sourceMappingURL` comments; without one, `sourcemaps.disable` below suppresses generation, so it is
	// also zero. Browser maps are never published either way.
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
				source: '/invites/modmail',
				destination:
					'https://discord.com/oauth2/authorize?client_id=981971797480210523&permissions=360777370624&scope=applications.commands%20bot',
				permanent: false,
			},
			{
				source: '/invites/automoderator',
				destination:
					'https://discord.com/oauth2/authorize?client_id=847081327950168104&permissions=1374926498982&scope=applications.commands%20bot',
				permanent: false,
			},
			{
				source: '/kofi',
				destination: 'https://ko-fi.com/chatsift',
				permanent: true,
			},
		];
	},
};

export default withSentryConfig(nextConfig, {
	// The self-hosted GlitchTip instance (docker-compose.yml + build/caddy/Caddyfile), not sentry.io. Both
	// slugs must match the org and project created there -- see docs/workflow.md.
	sentryUrl: 'https://errors.automoderator.app',
	org: 'chatsift',
	project: 'website',
	authToken: process.env.SENTRY_AUTH_TOKEN,
	// We self-host precisely so this data stays ours; do not phone build metrics home to a vendor.
	telemetry: false,
	sourcemaps: {
		// Without a token there is nowhere to upload to, so skip the whole mechanism: no maps are generated
		// and none are published. This is the *first* condition `maybeEnableTurbopackSourcemaps` checks, so
		// it also stops the SDK enabling `productionBrowserSourceMaps` on a build that could not upload.
		disable: !hasUploadToken,
		// Already the default once the SDK owns the flag above, but stated outright: this is the line that
		// actually stops the maps being served, and it should not silently change with an SDK default.
		//
		// Note deletion runs even when the upload *fails* -- verified locally against an unreachable host,
		// where the build still exited 0 with the maps gone. So a silently broken upload costs symbolication
		// rather than leaking maps, which is the right way round, but it does mean the build log is the only
		// place that failure shows. docs/workflow.md has the ordered check.
		deleteSourcemapsAfterUpload: true,
	},
	// Nothing here uses Session Replay, so drop its dead weight from the client bundle.
	bundleSizeOptimizations: {
		excludeReplayShadowDom: true,
		excludeReplayIframe: true,
		excludeReplayWorker: true,
		excludeDebugStatements: true,
	},
});
