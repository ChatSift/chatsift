import { useIsMounted } from './useIsMounted';

export function useCurrentURL(): URL | null {
	const mounted = useIsMounted();

	if (!mounted) {
		return null;
	}

	return new URL(window.location.href);
}
