'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useDebounceCallback } from 'usehooks-ts';
import { Button } from '@/components/common/Button';

const DEBOUNCE_TIME = 300;

interface SearchBarProps {
	readonly placeholder: string;
}

export function SearchBar({ placeholder }: SearchBarProps) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [searchValue, setSearchValue] = useState(searchParams.get('search') ?? '');

	const updateCallback = (newSearchValue: string) => {
		const params = new URLSearchParams(searchParams);
		if (newSearchValue.trim()) {
			params.set('search', newSearchValue.trim());
		} else {
			params.delete('search');
		}

		params.delete('page');

		router.replace(`${pathname}?${params.toString()}`);
	};

	const update = useDebounceCallback(updateCallback, DEBOUNCE_TIME);

	const handleClear = () => {
		setSearchValue('');

		const params = new URLSearchParams(searchParams);
		params.delete('search');
		params.delete('page');

		router.replace(`${pathname}?${params.toString()}`);
	};

	return (
		<div className="bg-card dark:bg-card-dark border border-on-secondary dark:border-on-secondary-dark rounded-lg p-4 flex gap-3 items-center">
			<input
				className="w-full px-3 py-2 border border-on-secondary dark:border-on-secondary-dark rounded-md bg-card dark:bg-card-dark text-primary dark:text-primary-dark focus:outline-none focus:ring-2 focus:ring-misc-accent focus:border-misc-accent"
				onChange={(e) => {
					update(e.target.value);
					setSearchValue(e.target.value);
				}}
				placeholder={placeholder}
				type="text"
				value={searchValue}
			/>
			<Button
				className="h-10 px-4 py-2 border border-on-secondary dark:border-on-secondary-dark text-primary dark:text-primary-dark rounded-md hover:bg-on-tertiary dark:hover:bg-on-tertiary-dark transition-colors text-sm"
				isDisabled={!searchValue.trim()}
				onClick={handleClear}
				type="button"
			>
				Clear
			</Button>
		</div>
	);
}
