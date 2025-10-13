import { Button } from '@/components/common/Button';

interface RawPromptFieldProps {
	onFormatClick(): void;
	onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>): void;
	onValueChange(value: string): void;
	readonly value: string;
}

export function RawPromptField({ value, onValueChange, onFormatClick, onPaste }: RawPromptFieldProps) {
	return (
		<div>
			<div className="flex justify-between items-center mb-2">
				<label className="block text-sm font-medium text-secondary dark:text-secondary-dark" htmlFor="promptRaw">
					Raw JSON Prompt
				</label>
				<Button
					className="px-3 py-1 text-sm rounded-md bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark hover:bg-on-secondary dark:hover:bg-on-secondary-dark transition-colors"
					onClick={onFormatClick}
				>
					Format
				</Button>
			</div>
			<textarea
				className="w-full px-3 py-2 border border-on-secondary dark:border-on-secondary-dark rounded-md bg-card dark:bg-card-dark text-primary dark:text-primary-dark focus:outline-none focus:ring-2 focus:ring-misc-accent focus:border-misc-accent font-mono text-sm"
				id="promptRaw"
				onChange={(e) => onValueChange(e.target.value)}
				onPaste={onPaste}
				placeholder={'{\n  "content": "Message text",\n  "embeds": [...]\n}'}
				rows={10}
				value={value}
			/>
			<p className="mt-1 text-xs text-secondary dark:text-secondary-dark">
				Paste a Discord message JSON payload. It will be auto-formatted on paste.
			</p>
		</div>
	);
}
