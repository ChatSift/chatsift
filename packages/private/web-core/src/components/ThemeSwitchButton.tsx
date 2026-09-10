'use client';

import { useTheme } from 'next-themes';
import { useIsMounted } from '../hooks/useIsMounted';
import { Button } from './Button';
import { Skeleton } from './Skeleton';
import { SvgDarkTheme } from './icons/SvgDarkTheme';
import { SvgLightTheme } from './icons/SvgLightTheme';

export function ThemeSwitchButton() {
	const isMounted = useIsMounted();
	const { theme, setTheme } = useTheme();

	// The rendered icon depends on the resolved theme, which only exists in the browser -- rendering either one
	// on the server guarantees a hydration mismatch, so the placeholder holds the same box until mount.
	if (!isMounted) {
		return <Skeleton className="h-6 w-9" />;
	}

	return (
		<Button
			className="h-6"
			onPress={() => {
				setTheme(theme === 'light' ? 'dark' : 'light');
			}}
		>
			{theme === 'light' ? <SvgLightTheme /> : <SvgDarkTheme />}
		</Button>
	);
}
