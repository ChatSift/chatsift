import { Button } from '@/components/common/Button';
import { cn } from '@/utils/util';

interface PanelRawFieldProps {
	readonly error?: string | undefined;
	onFormatClick(): void;
	onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>): void;
	onValueChange(value: string): void;
	readonly value: string;
}

export function PanelRawField({ value, onValueChange, onFormatClick, onPaste, error }: PanelRawFieldProps) {
	return (
		<div>
			<div className="flex justify-between items-center mb-2">
				<label className="block text-sm font-medium text-secondary dark:text-secondary-dark" htmlFor="panelRaw">
					Raw JSON Panel Message
				</label>
				<Button
					className="px-3 py-1 text-sm rounded-md bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark hover:bg-on-secondary dark:hover:bg-on-secondary-dark transition-colors"
					onClick={onFormatClick}
				>
					Format
				</Button>
			</div>
			<textarea
				aria-describedby="panelRaw-help"
				aria-invalid={error ? true : undefined}
				className={cn(
					'w-full px-3 py-2 border border-on-secondary dark:border-on-secondary-dark rounded-md bg-card dark:bg-card-dark text-primary dark:text-primary-dark focus:outline-none focus:ring-2 focus:ring-misc-accent focus:border-misc-accent font-mono text-sm',
					// `dark:border-on-secondary-dark` above compiles to a two-class selector, so it outranks a plain
					// `border-misc-danger` in dark mode unless the same variant is repeated here.
					error && 'border-misc-danger dark:border-misc-danger focus:ring-misc-danger',
				)}
				id="panelRaw"
				onChange={(e) => onValueChange(e.target.value)}
				onPaste={onPaste}
				placeholder={'{\n  "content": "Message text",\n  "embeds": [...]\n}'}
				rows={10}
				value={value}
			/>
			{error ? (
				<p className="mt-1 text-sm text-misc-danger" id="panelRaw-help">
					{error}
				</p>
			) : (
				<p className="mt-1 text-xs text-secondary dark:text-secondary-dark" id="panelRaw-help">
					Paste a Discord message JSON payload. It will be auto-formatted on paste.
				</p>
			)}
		</div>
	);
}
