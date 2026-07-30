import { TextAreaField } from '@/components/common/TextAreaField';
import { TextField } from '@/components/common/TextField';

interface PanelEmbedFieldsProps {
	readonly buttonLabel: string;
	readonly description: string;
	readonly errors: {
		readonly buttonLabel?: string;
		readonly description?: string;
		readonly title?: string;
	};
	onButtonLabelChange(value: string): void;
	onDescriptionChange(value: string): void;
	onTitleChange(value: string): void;
	readonly title: string;
}

export function PanelEmbedFields({
	title,
	description,
	buttonLabel,
	errors,
	onTitleChange,
	onDescriptionChange,
	onButtonLabelChange,
}: PanelEmbedFieldsProps) {
	return (
		<div className="space-y-4">
			<TextField
				error={errors.title}
				id="panel-title"
				label="Title"
				maxLength={255}
				onChange={onTitleChange}
				placeholder="Need help?"
				value={title}
			/>

			<TextAreaField
				error={errors.description}
				id="panel-description"
				label="Description (optional, max 4000 characters)"
				maxLength={4_000}
				onChange={onDescriptionChange}
				placeholder="Click the button below to open a ticket."
				rows={4}
				value={description}
			/>

			<TextField
				error={errors.buttonLabel}
				id="panel-button-label"
				label="Button Label"
				maxLength={80}
				onChange={onButtonLabelChange}
				placeholder="Create Ticket"
				value={buttonLabel}
			/>
		</div>
	);
}
