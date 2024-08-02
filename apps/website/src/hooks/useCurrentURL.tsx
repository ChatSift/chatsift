import { useIsMounted } from '~/hooks/useIsMounted';

export function useCurrentURL(): URL | null {
	const mounted = useIsMounted();

	if (!mounted) {
		return null;
	}

	return new URL(window.location.href);
}
