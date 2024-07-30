/**
 * @type {import('next').NextConfig}
 */
export default {
	reactStrictMode: true,
	images: {
		dangerouslyAllowSVG: true,
		contentDispositionType: 'attachment',
		contentSecurityPolicy: "default-src 'self'; frame-src 'none'; sandbox;",
	},
	logging: {
		fetches: {
			fullUrl: true,
		},
	},
};
