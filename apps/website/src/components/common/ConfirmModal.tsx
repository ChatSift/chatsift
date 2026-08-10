'use client';

import type { ReactNode } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { Button } from '@/components/common/Button';
import { cn } from '@/utils/util';

interface ConfirmModalProps {
	readonly children?: ReactNode;
	readonly confirmLabel?: string;
	readonly isDestructive?: boolean;
	readonly isOpen: boolean;
	onConfirm(): Promise<void> | void;
	onOpenChange(isOpen: boolean): void;
	readonly title: string;
}

/**
 * Modal confirmation for an action that can't be undone. Replaces the older inline "click Delete, the
 * button turns into Yes, delete / Cancel" pattern (`CategoryCard.tsx`, `SnippetCard.tsx`, ...) -- inline
 * confirms have no room for context about what the action actually affects, which matters as soon as
 * the thing being deleted is referenced elsewhere.
 *
 * `Button` already tracks its own pending state and surfaces a thrown error as a banner, so `onConfirm`
 * can just be the raw `mutateAsync` -- but it doesn't know about this modal, hence the explicit close
 * after it resolves. A rejected `onConfirm` deliberately leaves the modal open, so the error banner
 * appears over the still-visible thing it's about.
 */
export function ConfirmModal({
	isOpen,
	onOpenChange,
	title,
	children,
	confirmLabel = 'Confirm',
	isDestructive = false,
	onConfirm,
}: ConfirmModalProps) {
	return (
		<ModalOverlay
			className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 backdrop-blur-sm data-[entering]:animate-in data-[exiting]:animate-out data-[entering]:fade-in data-[exiting]:fade-out data-[entering]:duration-150 data-[exiting]:duration-100"
			isDismissable
			isOpen={isOpen}
			onOpenChange={onOpenChange}
		>
			<Modal className="w-full max-w-sm rounded-lg border border-on-secondary bg-card shadow-2xl dark:border-on-secondary-dark dark:bg-card-dark data-[entering]:animate-in data-[exiting]:animate-out data-[entering]:zoom-in-95 data-[exiting]:zoom-out-95 data-[entering]:duration-150 data-[exiting]:duration-100">
				{/* `alertdialog` rather than `dialog`: every use of this is a destructive-or-irreversible confirm, and
					it's what makes a screen reader announce the body copy rather than just the title. React Aria
					autofocuses the first focusable child, which is deliberately Cancel -- landing on the confirm
					button of a delete prompt is how you delete something by reflex-pressing Enter. */}
				<Dialog className="p-5 outline-none" role="alertdialog">
					<Heading className="text-lg font-medium text-primary dark:text-primary-dark" slot="title">
						{title}
					</Heading>
					{children && <div className="mt-2 text-sm text-secondary dark:text-secondary-dark">{children}</div>}
					<div className="mt-5 flex justify-end gap-2">
						<Button
							className="border border-on-secondary px-3 text-sm text-primary dark:border-on-secondary-dark dark:text-primary-dark"
							onPress={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button
							// `text-accent` is the theme's white -- `text-white` compiles to nothing here, since the
							// `--color-*: initial` in globals.css drops Tailwind's default palette.
							className={cn(
								'px-3 text-sm font-medium text-accent',
								isDestructive
									? 'bg-misc-danger hover:bg-misc-danger/85 active:bg-misc-danger/75'
									: 'bg-misc-accent hover:bg-misc-accent/85 active:bg-misc-accent/75',
							)}
							onPress={async () => {
								await onConfirm();
								onOpenChange(false);
							}}
						>
							{confirmLabel}
						</Button>
					</div>
				</Dialog>
			</Modal>
		</ModalOverlay>
	);
}
