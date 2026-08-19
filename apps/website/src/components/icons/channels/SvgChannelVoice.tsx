interface SvgChannelVoiceProps {
	readonly className?: string;
	readonly size?: number;
}

/**
 * Used for both voice and stage channels, which is why it is a plain speaker rather than anything
 * stage-specific -- the picker only ever needs "this one carries voice", and one glyph for both keeps the list
 * readable.
 *
 * Deliberately built from straight segments and two circular arcs rather than traced bezier curves: every
 * coordinate here can be reasoned about, where a hand-written bezier path cannot. Stroke width matches the
 * visual weight of the filled glyphs beside it (`SvgChannelText`'s hash, `SvgChannelForum`'s bubble).
 */
export function SvgChannelVoice({ className, size = 20 }: SvgChannelVoiceProps) {
	return (
		<svg
			className={className}
			fill="none"
			height={size}
			viewBox="0 0 24 24"
			width={size}
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M12 4 L7 9 H3 V15 H7 L12 20 Z" fill="currentColor" />
			<path
				d="M14.5 9.5a3.5 3.5 0 0 1 0 5M17 7a7 7 0 0 1 0 10"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeWidth="2"
			/>
		</svg>
	);
}
