export const URLS = {
	API: {
		login: (redirectTo?: string) => {
			const url = new URL(`${process.env['NEXT_PUBLIC_API_URL']}/v3/auth/discord`);
			if (redirectTo) {
				url.searchParams.set('redirect_to', redirectTo);
			}

			return url.toString();
		},
	},
} as const;
