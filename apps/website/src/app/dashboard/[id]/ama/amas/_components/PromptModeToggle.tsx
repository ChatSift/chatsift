import { SegmentedControl } from '@/components/common/SegmentedControl';

export type PromptMode = 'normal' | 'raw';

interface PromptModeToggleProps {
	readonly mode: PromptMode;
	onModeChange(mode: PromptMode): void;
}

const options = [
	{ value: 'normal', label: 'Normal Prompt' },
	{ value: 'raw', label: 'Raw JSON' },
] as const satisfies readonly { label: string; value: PromptMode }[];

export function PromptModeToggle({ mode, onModeChange }: PromptModeToggleProps) {
	return <SegmentedControl label="Prompt mode" onChange={onModeChange} options={options} value={mode} />;
}
