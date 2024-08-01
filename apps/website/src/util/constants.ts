export const URLS = (host: string) =>
	({
		API: {
			LOGIN: `${process.env.NEXT_PUBLIC_API_URL}/auth/discord?redirect_uri=${host}/dashboard`,
		},
	}) as const;
