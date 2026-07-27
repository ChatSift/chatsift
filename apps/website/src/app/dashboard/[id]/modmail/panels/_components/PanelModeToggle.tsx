import { Button } from '@/components/common/Button';
import { cn } from '@/utils/util';

type PanelMode = 'normal' | 'raw';

interface PanelModeToggleProps {
	readonly mode: PanelMode;
	onModeChange(mode: PanelMode): void;
}

const options: { label: string; value: PanelMode }[] = [
	{ value: 'normal', label: 'Normal Embed' },
	{ value: 'raw', label: 'Raw JSON' },
];

export function PanelModeToggle({ mode, onModeChange }: PanelModeToggleProps) {
	return (
		<div
			aria-label="Panel mode"
			className="inline-flex gap-1 rounded-md border border-on-secondary bg-on-tertiary p-1 dark:border-on-secondary-dark dark:bg-on-tertiary-dark"
			role="group"
		>
			{options.map((option) => (
				<Button
					aria-pressed={mode === option.value}
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
