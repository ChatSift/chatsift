'use client';

import { useTheme } from 'next-themes';
import { Button } from '@/components/common/Button';
import { Skeleton } from '@/components/common/Skeleton';
import { SvgDarkTheme } from '@/components/icons/SvgDarkTheme';
import { SvgLightTheme } from '@/components/icons/SvgLightTheme';
import { useIsMounted } from '@/hooks/isMounted';

export function ThemeSwitchButton() {
	const isMounted = useIsMounted();
	const { theme, setTheme } = useTheme();

	if (!isMounted) {
		return <Skeleton className="h-6 w-9" />;
	}

	return (
		<Button
			className="h-6"
			form="extraSmall"
			onPress={() => {
				setTheme(theme === 'light' ? 'dark' : 'light');
			}}
		>
			{theme === 'light' ? <SvgLightTheme /> : <SvgDarkTheme />}
		</Button>
	);
}
