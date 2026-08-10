import { Button } from './Button';

interface FormActionsProps {
	readonly cancelLabel?: string;
	readonly isSubmitDisabled?: boolean;
	readonly isSubmitting: boolean;
	onCancel(): void;
	readonly pendingLabel: string;
	readonly submitLabel: string;
}

/**
 * The submit + cancel button pair repeated at the bottom of every create/edit form in the dashboard.
 */
export function FormActions({
	submitLabel,
	pendingLabel,
	isSubmitting,
	isSubmitDisabled = false,
	onCancel,
	cancelLabel = 'Cancel',
}: FormActionsProps) {
	return (
		<div className="flex gap-4">
			<Button
				className="px-3 py-2.5 bg-misc-accent text-accent rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
				isDisabled={isSubmitDisabled || isSubmitting}
				type="submit"
			>
				{isSubmitting ? pendingLabel : submitLabel}
			</Button>
			<Button
				className="px-3 py-2.5 bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark rounded-md hover:bg-on-secondary dark:hover:bg-on-secondary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
				isDisabled={isSubmitting}
				onPress={onCancel}
				type="button"
			>
				{cancelLabel}
			</Button>
		</div>
	);
}
