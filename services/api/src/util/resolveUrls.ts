// We make use of a set as it is the cleanest and fastest way to remove duplication from the domain checking
export const resolveUrls = (toResolve: string[]): Set<string> => toResolve.reduce((urls, url) => {
  // Only dealing with something that contains a path
  if (url.includes('/')) {
    // Assume that the URL is formatted correctly. Extract the domain
    urls.add(url.split('/')[0]!);
  }

  return urls;
}, new Set(toResolve));
