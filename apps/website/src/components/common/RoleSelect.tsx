'use client';

import { useEffect, useRef, useState } from 'react';
import { SvgChevronDown } from '../icons/SvgChevronDown';
import { Button } from './Button';
import { ScrollArea } from './ScrollArea';
import type { GuildRoleInfo } from '@/api/routes/guilds';
import { cn } from '@/utils/util';

interface RoleSelectProps {
	readonly error?: string | undefined;
	readonly label: string;
	onChange(roleId: string | undefined): void;
	readonly placeholder?: string;
	readonly required?: boolean;
	readonly roles: GuildRoleInfo[];
	readonly selectedId: string;
	readonly value: string;
}

function roleColor(color: number): string {
	// Discord represents "no color" (the default role color) as `0`, which would otherwise render as pure black.
	return color === 0 ? '#99aab5' : `#${color.toString(16).padStart(6, '0')}`;
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
					<span className="flex items-center gap-2 flex-1 min-w-0">
						{selectedRole ? (
							<RoleItem role={selectedRole} />
						) : (
							<span className="text-secondary dark:text-secondary-dark">{placeholder}</span>
						)}
					</span>
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
							{sortedRoles.map((role) => (
								<Button
									className={cn(
										'w-full px-3 py-2 text-left transition-colors hover:bg-on-tertiary dark:hover:bg-on-tertiary-dark cursor-pointer',
										value === role.id && 'bg-misc-accent/10 text-misc-accent',
									)}
									key={role.id}
									onClick={() => handleSelect(role.id)}
								>
									<RoleItem role={role} />
								</Button>
							))}
						</ScrollArea>
					</div>
				)}
			</div>
			{error && <p className="mt-1 text-sm text-misc-danger">{error}</p>}
		</div>
	);
}
