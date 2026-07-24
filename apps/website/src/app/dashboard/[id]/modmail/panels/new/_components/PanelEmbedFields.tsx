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
			<div>
				<label className="block text-sm font-medium text-secondary dark:text-secondary-dark mb-2" htmlFor="panel-title">
					Title
				</label>
				<input
					className="w-full px-3 py-2 border border-on-secondary dark:border-on-secondary-dark rounded-md bg-card dark:bg-card-dark text-primary dark:text-primary-dark focus:outline-none focus:ring-2 focus:ring-misc-accent focus:border-misc-accent"
					id="panel-title"
					maxLength={255}
					onChange={(e) => onTitleChange(e.target.value)}
					placeholder="Need help?"
					type="text"
					value={title}
				/>
				{errors.title && <p className="mt-1 text-sm text-misc-danger">{errors.title}</p>}
			</div>

			<div>
				<label
					className="block text-sm font-medium text-secondary dark:text-secondary-dark mb-2"
					htmlFor="panel-description"
				>
					Description (optional, max 4000 characters)
				</label>
				<textarea
					className="w-full px-3 py-2 border border-on-secondary dark:border-on-secondary-dark rounded-md bg-card dark:bg-card-dark text-primary dark:text-primary-dark focus:outline-none focus:ring-2 focus:ring-misc-accent focus:border-misc-accent"
					id="panel-description"
					maxLength={4_000}
					onChange={(e) => onDescriptionChange(e.target.value)}
					placeholder="Click the button below to open a ticket."
					rows={4}
					value={description}
				/>
				{errors.description && <p className="mt-1 text-sm text-misc-danger">{errors.description}</p>}
			</div>

			<div>
				<label
					className="block text-sm font-medium text-secondary dark:text-secondary-dark mb-2"
					htmlFor="panel-button-label"
				>
					Button Label
				</label>
				<input
					className="w-full px-3 py-2 border border-on-secondary dark:border-on-secondary-dark rounded-md bg-card dark:bg-card-dark text-primary dark:text-primary-dark focus:outline-none focus:ring-2 focus:ring-misc-accent focus:border-misc-accent"
					id="panel-button-label"
					maxLength={80}
					onChange={(e) => onButtonLabelChange(e.target.value)}
					placeholder="Create Ticket"
					type="text"
					value={buttonLabel}
				/>
				{errors.buttonLabel && <p className="mt-1 text-sm text-misc-danger">{errors.buttonLabel}</p>}
			</div>
		</div>
	);
}
