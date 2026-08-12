export function SvgSocial({ width, height }: { readonly height?: number; readonly width?: number }) {
	return (
		<svg fill="none" height={height ?? 24} viewBox="4 4 16 16" width={width ?? 24} xmlns="http://www.w3.org/2000/svg">
			{/* Social's real brand mark. Same treatment as SvgModmail: the brand plate behind it is dropped and its
			    two ink colors become theme tokens (frame #58AAFF -> misc-accent, face white -> primary), so the icon
			    reads on both the light and dark dashboard surfaces instead of only on the plate.

			    Paths are the export verbatim; the viewBox is tightened from the exported 0 0 24 24 to crop the
			    padding that plate needed. That scales the 1.25 strokes to an effective 1.875 at a 24px render --
			    exactly SvgModmail's weight, which is what the glyph was drawn against. */}
			<path className="stroke-misc-accent" d="M7 7H17V17H7V7Z" strokeLinejoin="round" strokeWidth="1.25" />
			<circle className="fill-primary dark:fill-primary-dark" cx="12" cy="10.875" r="0.875" />
			<path
				className="stroke-primary dark:stroke-primary-dark"
				d="M10 14C10.3992 13.4022 11.1454 13 12 13"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.25"
			/>
			<path
				className="stroke-primary dark:stroke-primary-dark"
				d="M12 13C12.9818 13 14 13 14.5 11.5"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.25"
			/>
		</svg>
	);
}
