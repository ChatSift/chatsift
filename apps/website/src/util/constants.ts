export const URLS = {
	API: {
		LOGIN: `${process.env.NEXT_PUBLIC_API_URL}/auth/discord?redirect_path=/dashboard`,
	},
} as const;
