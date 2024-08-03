export const URLS = {
	API: {
		LOGIN: `${process.env.NEXT_PUBLIC_API_URL}/auth/discord?redirect_path=/dashboard`,
		LOGOUT: `${process.env.NEXT_PUBLIC_API_URL}/auth/discord/logout`,
	},
} as const;
