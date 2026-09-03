import { SegmentedControl } from '@/components/common/SegmentedControl';

type PanelMode = 'normal' | 'raw';

interface PanelModeToggleProps {
	readonly mode: PanelMode;
	onModeChange(mode: PanelMode): void;
}

const options = [
	{ value: 'normal', label: 'Normal Embed' },
	{ value: 'raw', label: 'Raw JSON' },
] as const satisfies readonly { label: string; value: PanelMode }[];

export function PanelModeToggle({ mode, onModeChange }: PanelModeToggleProps) {
	return <SegmentedControl label="Panel mode" onChange={onModeChange} options={options} value={mode} />;
}
