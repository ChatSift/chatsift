import { ColorField } from '@/components/common/ColorField';
import { TextAreaField } from '@/components/common/TextAreaField';
import { TextField } from '@/components/common/TextField';

interface NormalPromptFieldsProps {
	/**
	 * `#rrggbb`, or empty for "use the default" -- see `ColorField`.
	 */
	readonly color: string;
	readonly description: string;
	readonly errors: {
		readonly color?: string;
		readonly description?: string;
		readonly imageURL?: string;
		readonly plainText?: string;
		readonly thumbnailURL?: string;
	};
	readonly imageURL: string;
	onColorChange(value: string): void;
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
	color,
	errors,
	onPlainTextChange,
	onDescriptionChange,
	onImageURLChange,
	onThumbnailURLChange,
	onColorChange,
}: NormalPromptFieldsProps) {
	return (
		<div className="space-y-4">
			<TextField
				error={errors.plainText}
				id="plainText"
				label="Plain Text (optional, max 100 characters)"
				maxLength={100}
				onChange={onPlainTextChange}
				placeholder="Message content above the embed"
				value={plainText}
			/>

			<TextAreaField
				error={errors.description}
				id="description"
				label="Description (optional, max 4000 characters)"
				maxLength={4_000}
				onChange={onDescriptionChange}
				placeholder="Embed description text"
				rows={4}
				value={description}
			/>

			<ColorField
				error={errors.color}
				helper={
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Optional. The stripe down the left edge of the embed.
					</p>
				}
				id="color"
				label="Embed Color"
				onChange={onColorChange}
				value={color}
			/>

			<TextField
				error={errors.imageURL}
				id="imageURL"
				label="Image URL (optional)"
				onChange={onImageURLChange}
				placeholder="https://example.com/image.png"
				type="url"
				value={imageURL}
			/>

			<TextField
				error={errors.thumbnailURL}
				id="thumbnailURL"
				label="Thumbnail URL (optional)"
				onChange={onThumbnailURLChange}
				placeholder="https://example.com/thumbnail.png"
				type="url"
				value={thumbnailURL}
			/>
		</div>
	);
}
