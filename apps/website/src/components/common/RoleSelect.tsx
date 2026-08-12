'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { SvgChevronDown } from '../icons/SvgChevronDown';
import { Button } from './Button';
import { ScrollArea } from './ScrollArea';
import type { GuildRoleInfo } from '@/api/routes/guilds';
import { cn, roleColor } from '@/utils/util';

interface RoleSelectProps {
	/**
	 * Roles that stay listed but can't be picked -- see `ChannelSelect`'s equivalent for why they're greyed out
	 * rather than filtered out.
	 */
	readonly disabledIds?: readonly string[] | undefined;
	/**
	 * Why `disabledIds` are disabled, shown beside each of them.
	 */
	readonly disabledReason?: string | undefined;
	readonly error?: string | undefined;
	/**
	 * Whether the option list is still being fetched. Without this the component cannot tell "this id isn't
	 * loaded yet" from "this id no longer exists", and would flash a false deletion warning on every load of a
	 * perfectly valid config. Callers feeding it a value from saved config must pass their guild-info loading
	 * flag; create flows start with an empty value and don't need it.
	 */
	readonly isLoading?: boolean | undefined;
	readonly label: string;
	onChange(roleId: string | undefined): void;
	readonly placeholder?: string;
	readonly required?: boolean;
	readonly roles: GuildRoleInfo[];
	readonly selectedId: string;
	readonly value: string;
}

function RoleItem({ role }: { readonly role: GuildRoleInfo }) {
	return (
		<div className="flex min-w-0 items-center gap-2">
			<span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: roleColor(role.color) }} />
			<span className="truncate text-sm">{role.name}</span>
		</div>
	);
}

export function RoleSelect({
	selectedId,
	label,
	value,
	onChange,
	roles,
	error,
	placeholder = 'Select a role',
	required = false,
	disabledIds,
	disabledReason,
	isLoading = false,
}: RoleSelectProps) {
	const [isOpen, setIsOpen] = useState(false);
	const selectRef = useRef<HTMLDivElement>(null);

	const sortedRoles = [...roles].sort((a, b) => b.position - a.position);
	const selectedRole = roles.find((role) => role.id === value);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
				setIsOpen(false);
			}
		};

		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside);
		}

		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [isOpen]);

	const handleSelect = (roleId: string | undefined) => {
		onChange(roleId);
		setIsOpen(false);
	};

	// A `value` naming a role Discord no longer has is a real, reachable state: the config row outlives the
	// role (SocialRolesList says so at its card label, and renders exactly this wording). Falling through to
	// the placeholder made that indistinguishable from "nothing selected" -- so an edit form for a dangling
	// row looked untouched while still holding the old id, and saving it silently rewrote the same dead
	// reference. Deliberately *not* cleared here: mutating form state during render would turn opening a page
	// into an edit, and the dropdown's "None" (or picking a live role) is the explicit fix.
	let trigger: ReactNode;
	if (selectedRole) {
		trigger = <RoleItem role={selectedRole} />;
	} else if (value && !isLoading) {
		trigger = <span className="truncate text-sm text-misc-danger">Deleted role ({value})</span>;
	} else {
		trigger = <span className="text-secondary dark:text-secondary-dark">{placeholder}</span>;
	}

	return (
		<div>
			<label className="block text-sm font-medium text-secondary dark:text-secondary-dark mb-2" htmlFor={selectedId}>
				{label} {required && '*'}
			</label>
			<div className="relative" ref={selectRef}>
				<Button
					className={cn(
						'text-base w-full px-3 py-2 border border-on-secondary dark:border-on-secondary-dark rounded-md bg-card dark:bg-card-dark text-primary dark:text-primary-dark focus:outline-none focus:ring-2 focus:ring-misc-accent focus:border-misc-accent text-left flex items-center justify-between',
						error && 'border-misc-danger focus:ring-misc-danger',
					)}
					id={selectedId}
					onClick={() => setIsOpen(!isOpen)}
					type="button"
				>
					<span className="flex items-center gap-2 flex-1 min-w-0">{trigger}</span>
					<SvgChevronDown
						className={cn(
							'transition-transform text-secondary dark:text-secondary-dark shrink-0',
							isOpen && 'rotate-180',
						)}
						size={16}
					/>
				</Button>

				{isOpen && (
					<div className="absolute z-50 w-full mt-1 bg-card dark:bg-card-dark border border-on-secondary dark:border-on-secondary-dark rounded-md shadow-lg">
						<ScrollArea className="max-h-80">
							{!required && (
								<Button
									className={cn(
										'w-full px-3 py-2 text-left transition-colors hover:bg-on-tertiary dark:hover:bg-on-tertiary-dark cursor-pointer',
										!value && 'bg-misc-accent/10 text-misc-accent',
									)}
									key="none"
									onClick={() => handleSelect(undefined)}
								>
									<span className="text-sm text-secondary dark:text-secondary-dark">None</span>
								</Button>
							)}
							{sortedRoles.map((role) => {
								const isDisabled = disabledIds?.includes(role.id) ?? false;

								return (
									<Button
										className={cn(
											'w-full px-3 py-2 text-left transition-colors',
											isDisabled
												? 'cursor-not-allowed opacity-50'
												: 'hover:bg-on-tertiary dark:hover:bg-on-tertiary-dark cursor-pointer',
											value === role.id && !isDisabled && 'bg-misc-accent/10 text-misc-accent',
										)}
										isDisabled={isDisabled}
										key={role.id}
										onClick={() => handleSelect(role.id)}
									>
										<RoleItem role={role} />
										{isDisabled && disabledReason && (
											<span className="ml-2 text-xs text-secondary dark:text-secondary-dark">({disabledReason})</span>
										)}
									</Button>
								);
							})}
						</ScrollArea>
					</div>
				)}
			</div>
			{error && <p className="mt-1 text-sm text-misc-danger">{error}</p>}
		</div>
	);
}
