import { useEffect, useState } from 'react';

export function useIsMounted(): boolean {
	const [mounted, setMounted] = useState<boolean>(false);

	// See https://github.com/pacocoursey/next-themes?tab=readme-ov-file#avoid-hydration-mismatch
	useEffect(() => {
		setMounted(true);
	}, []);

	return mounted;
}
