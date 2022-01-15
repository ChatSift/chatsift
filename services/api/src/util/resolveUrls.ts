const addRootFromSub = (urls: Set<string>, url: string): void => {
	const split = url.split('.');
	// This means that we've got at least 1 subdomain - there could be more nested
	if (split.length > 2) {
		// Extract the root domain
		urls.add(split.slice(split.length - 2, split.length).join('.'));
	}
};

// We make use of a set as it is the cleanest and fastest way to remove duplication from the domain checking
export const resolveUrls = (toResolve: string[]): Set<string> =>
	toResolve.reduce((urls, url) => {
		// Deal with something that contains the path
		if (url.includes('/')) {
			// Assume that the URL is formatted correctly. Extract the domain (including the subdomain)
			const fullDomain = url.split('/')[0]!;
			urls.add(fullDomain);
			// Also add it without a potential subdomain

			addRootFromSub(urls, fullDomain);
		} else {
			addRootFromSub(urls, url);
		}

		return urls;
	}, new Set(toResolve));
