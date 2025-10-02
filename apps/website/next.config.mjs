/** @type {import('next').NextConfig} */
export default {
	reactStrictMode: true,
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
};
