'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AriaSearchFieldProps } from 'react-aria';
import { useSearchField } from 'react-aria';
import SvgSearch from '~/components/svg/SvgSearch';
import { cn } from '~/util/util';

const DEBOUNCE_TIME = 300;

export default function SearchBar({ className, ...props }: AriaSearchFieldProps & { readonly className?: string }) {
	const searchParams = useSearchParams();
	const pathname = usePathname();
	const router = useRouter();

	const [value, setValue] = useState(searchParams.get('search') ?? '');
	const ref = useRef(null);
	const { inputProps } = useSearchField(props, { value, setValue }, ref);

	const update = useCallback(() => {
		const params = new URLSearchParams(searchParams.toString());
		params.set('search', value);

		router.replace(`${pathname}?${params.toString()}`);
	}, [searchParams, value, router, pathname]);

	useEffect(() => {
		const timeout = setTimeout(update, DEBOUNCE_TIME);
		return () => clearTimeout(timeout);
	}, [update]);

	return (
		<div className={cn(className, 'relative flex')}>
			<input
				{...inputProps}
				ref={ref}
				className={cn(
					'w-full flex-auto rounded-lg bg-on-tertiary pb-3 pl-4 pr-12 pt-3 text-lg font-medium text-primary',
					'border-2 border-on-secondary dark:border-on-secondary-dark dark:bg-on-tertiary-dark dark:text-primary-dark',
					'focus:border-solid focus:border-primary focus:outline-none dark:focus:border-primary-dark',
					'disabled:cursor-not-allowed disabled:opacity-50',
					'placeholder:text-secondary dark:placeholder:text-secondary-dark',
				)}
			/>
			<SvgSearch className="absolute right-4 top-1/2 translate-y-[-50%]" />
		</div>
	);
}
