export function SvgAppeals({ width, height }: { readonly height?: number; readonly width?: number }) {
	return (
		<svg fill="none" height={height ?? 24} viewBox="4 4 16 16" width={width ?? 24} xmlns="http://www.w3.org/2000/svg">
			{/* Appeals' real brand mark. Same treatment as SvgSocial and SvgModmail: the brand plate behind it is
			    dropped and its two ink colors become theme tokens (frame #58AAFF -> misc-accent, check white ->
			    primary), so the icon reads on both the light and dark dashboard surfaces instead of only on the plate.

			    Paths are the export verbatim; the viewBox is tightened from the exported 0 0 24 24 to crop the
			    padding that plate needed. That scales the 1.25 strokes to an effective 1.875 at a 24px render --
			    exactly SvgModmail's weight, which is what the glyph was drawn against. */}
			<path
				className="stroke-misc-accent"
				d="M12 6L17.1962 9V15L12 18L6.80385 15V9L12 6Z"
				strokeLinejoin="round"
				strokeWidth="1.25"
			/>
			<path
				className="stroke-primary dark:stroke-primary-dark"
				d="M10.5 12.5L11.5 13.5L14 11"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.25"
			/>
		</svg>
	);
}
