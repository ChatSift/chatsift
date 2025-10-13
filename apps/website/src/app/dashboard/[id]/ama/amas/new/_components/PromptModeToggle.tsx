import { Button } from '@/components/common/Button';

type PromptMode = 'normal' | 'raw';

interface PromptModeToggleProps {
	readonly mode: PromptMode;
	onModeChange(mode: PromptMode): void;
}

export function PromptModeToggle({ mode, onModeChange }: PromptModeToggleProps) {
	return (
		<div className="flex gap-4">
			<Button
				className={`px-4 py-2 rounded-md transition-colors ${
					mode === 'normal'
						? 'bg-misc-accent text-white'
						: 'bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark'
				}`}
				onClick={() => onModeChange('normal')}
				type="button"
			>
				Normal Prompt
			</Button>
			<Button
				className={`px-4 py-2 rounded-md transition-colors ${
					mode === 'raw'
						? 'bg-misc-accent text-white'
						: 'bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark'
				}`}
				onClick={() => onModeChange('raw')}
			>
				Raw JSON
			</Button>
		</div>
	);
}
