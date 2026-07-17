import { Button } from '@/components/common/Button';
import { cn } from '@/utils/util';

type PromptMode = 'normal' | 'raw';

interface PromptModeToggleProps {
	readonly mode: PromptMode;
	onModeChange(mode: PromptMode): void;
}

const options: { label: string; value: PromptMode }[] = [
	{ value: 'normal', label: 'Normal Prompt' },
	{ value: 'raw', label: 'Raw JSON' },
];

export function PromptModeToggle({ mode, onModeChange }: PromptModeToggleProps) {
	return (
		<div className="inline-flex gap-1 rounded-md border border-on-secondary bg-on-tertiary p-1 dark:border-on-secondary-dark dark:bg-on-tertiary-dark">
			{options.map((option) => (
				<Button
					className={cn(
						'rounded px-4 py-1.5 text-sm font-medium transition-colors',
						mode === option.value
							? 'bg-misc-accent text-white shadow-sm'
							: 'text-secondary hover:bg-on-secondary/50 dark:text-secondary-dark dark:hover:bg-on-secondary-dark/50',
					)}
					key={option.value}
					onPress={() => onModeChange(option.value)}
					type="button"
				>
					{option.label}
				</Button>
			))}
		</div>
	);
}
