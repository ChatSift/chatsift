import { Button } from './Button';

interface FormActionsProps {
	readonly cancelLabel?: string;
	readonly isSubmitDisabled?: boolean;
	readonly isSubmitting: boolean;
	onCancel(): void;
	readonly pendingLabel: string;
	readonly showCancel?: boolean;
	readonly submitLabel: string;
}

/**
 * The submit + cancel button pair repeated at the bottom of every create/edit form in the dashboard --
 * `showCancel` exists only for the AMA grant flow, where `router.back()` would drop the one-time `?token=` param.
 */
export function FormActions({
	submitLabel,
	pendingLabel,
	isSubmitting,
	isSubmitDisabled = false,
	onCancel,
	cancelLabel = 'Cancel',
	showCancel = true,
}: FormActionsProps) {
	return (
		<div className="flex gap-4">
			<Button
				className="px-3 py-2.5 bg-misc-accent text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
				isDisabled={isSubmitDisabled || isSubmitting}
				type="submit"
			>
				{isSubmitting ? pendingLabel : submitLabel}
			</Button>
			{showCancel && (
				<Button
					className="px-3 py-2.5 bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark rounded-md hover:bg-on-secondary dark:hover:bg-on-secondary-dark transition-colors"
					onPress={onCancel}
					type="button"
				>
					{cancelLabel}
				</Button>
			)}
		</div>
	);
}
