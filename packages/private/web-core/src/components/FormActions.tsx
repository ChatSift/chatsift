import { Button } from './Button';
import { buttonClass } from './buttonStyles';

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
			<Button className={buttonClass('primary')} isDisabled={isSubmitDisabled || isSubmitting} type="submit">
				{isSubmitting ? pendingLabel : submitLabel}
			</Button>
			<Button className={buttonClass('secondary')} isDisabled={isSubmitting} onPress={onCancel} type="button">
				{cancelLabel}
			</Button>
		</div>
	);
}
