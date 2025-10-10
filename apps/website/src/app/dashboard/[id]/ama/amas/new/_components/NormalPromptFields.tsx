interface NormalPromptFieldsProps {
	readonly description: string;
	readonly errors: {
		readonly description?: string;
		readonly imageURL?: string;
		readonly plainText?: string;
		readonly thumbnailURL?: string;
	};
	readonly imageURL: string;
	onDescriptionChange(value: string): void;
	onImageURLChange(value: string): void;
	onPlainTextChange(value: string): void;
	onThumbnailURLChange(value: string): void;
	readonly plainText: string;
	readonly thumbnailURL: string;
}

export function NormalPromptFields({
	plainText,
	description,
	imageURL,
	thumbnailURL,
	errors,
	onPlainTextChange,
	onDescriptionChange,
	onImageURLChange,
	onThumbnailURLChange,
}: NormalPromptFieldsProps) {
	return (
		<div className="space-y-4">
			<div>
				<label className="block text-sm font-medium text-secondary dark:text-secondary-dark mb-2" htmlFor="plainText">
					Plain Text (optional, max 100 characters)
				</label>
				<input
					className="w-full px-3 py-2 border border-on-secondary dark:border-on-secondary-dark rounded-md bg-card dark:bg-card-dark text-primary dark:text-primary-dark focus:outline-none focus:ring-2 focus:ring-misc-accent focus:border-misc-accent"
					id="plainText"
					maxLength={100}
					onChange={(e) => onPlainTextChange(e.target.value)}
					placeholder="Message content above the embed"
					type="text"
					value={plainText}
				/>
				{errors.plainText && <p className="mt-1 text-sm text-red-500">{errors.plainText}</p>}
			</div>

			<div>
				<label className="block text-sm font-medium text-secondary dark:text-secondary-dark mb-2" htmlFor="description">
					Description (optional, max 4000 characters)
				</label>
				<textarea
					className="w-full px-3 py-2 border border-on-secondary dark:border-on-secondary-dark rounded-md bg-card dark:bg-card-dark text-primary dark:text-primary-dark focus:outline-none focus:ring-2 focus:ring-misc-accent focus:border-misc-accent"
					id="description"
					maxLength={4_000}
					onChange={(e) => onDescriptionChange(e.target.value)}
					placeholder="Embed description text"
					rows={4}
					value={description}
				/>
				{errors.description && <p className="mt-1 text-sm text-red-500">{errors.description}</p>}
			</div>

			<div>
				<label className="block text-sm font-medium text-secondary dark:text-secondary-dark mb-2" htmlFor="imageURL">
					Image URL (optional)
				</label>
				<input
					className="w-full px-3 py-2 border border-on-secondary dark:border-on-secondary-dark rounded-md bg-card dark:bg-card-dark text-primary dark:text-primary-dark focus:outline-none focus:ring-2 focus:ring-misc-accent focus:border-misc-accent"
					id="imageURL"
					onChange={(e) => onImageURLChange(e.target.value)}
					placeholder="https://example.com/image.png"
					type="url"
					value={imageURL}
				/>
				{errors.imageURL && <p className="mt-1 text-sm text-red-500">{errors.imageURL}</p>}
			</div>

			<div>
				<label
					className="block text-sm font-medium text-secondary dark:text-secondary-dark mb-2"
					htmlFor="thumbnailURL"
				>
					Thumbnail URL (optional)
				</label>
				<input
					className="w-full px-3 py-2 border border-on-secondary dark:border-on-secondary-dark rounded-md bg-card dark:bg-card-dark text-primary dark:text-primary-dark focus:outline-none focus:ring-2 focus:ring-misc-accent focus:border-misc-accent"
					id="thumbnailURL"
					onChange={(e) => onThumbnailURLChange(e.target.value)}
					placeholder="https://example.com/thumbnail.png"
					type="url"
					value={thumbnailURL}
				/>
				{errors.thumbnailURL && <p className="mt-1 text-sm text-red-500">{errors.thumbnailURL}</p>}
			</div>
		</div>
	);
}
