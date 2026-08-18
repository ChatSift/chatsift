'use client';

import { EmbedMessagePreview } from '@/components/common/EmbedMessagePreview';

interface NormalPanelPreviewProps {
	readonly attachmentUrl: string;
	readonly buttonLabel: string;
	/**
	 * `#rrggbb`, or empty for "use the default".
	 */
	readonly color: string;
	readonly description: string;
	readonly mode: 'normal';
	readonly thumbnailUrl: string;
	readonly title: string;
}

interface RawPanelPreviewProps {
	readonly mode: 'raw';
	readonly raw: string;
}

type PanelPreviewProps = NormalPanelPreviewProps | RawPanelPreviewProps;

/**
 * ModMail's ticket panel preview -- `EmbedMessagePreview` with this feature's own chrome filled in. Kept as a
 * named wrapper rather than inlined at the two call sites so the "Create Ticket" fallback (which matches
 * `createPanel.ts`'s server-side default) lives in exactly one place.
 */
export function PanelPreview(props: PanelPreviewProps) {
	const chrome = { heading: 'Panel preview', forBot: 'MODMAIL', defaultButtonLabel: 'Create Ticket' } as const;

	return props.mode === 'raw' ? (
		<EmbedMessagePreview {...chrome} mode="raw" raw={props.raw} />
	) : (
		<EmbedMessagePreview
			{...chrome}
			buttonLabel={props.buttonLabel}
			color={props.color}
			description={props.description}
			imageUrl={props.attachmentUrl}
			mode="normal"
			thumbnailUrl={props.thumbnailUrl}
			title={props.title}
		/>
	);
}
