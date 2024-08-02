export const URLS = {
	API: {
		LOGIN: (host: string) => `${process.env.NEXT_PUBLIC_API_URL}/auth/discord?redirect_uri=${host}/dashboard`,
	},
} as const;
