export const URLS = {
	API: {
		LOGIN: `${process.env.NEXT_PUBLIC_API_URL}/auth/discord?redirect_path=/dashboard`,
		LOGOUT: `${process.env.NEXT_PUBLIC_API_URL}/auth/discord/logout`,
	},
	INVITES: {
		AUTOMODERATOR: 'https://discord.com/oauth2/authorize?client_id=242730576195354624&permissions=8&scope=bot',
	},
} as const;
