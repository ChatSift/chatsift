export function SvgSocial({ width, height }: { readonly height?: number; readonly width?: number }) {
	return (
		<svg fill="none" height={height ?? 24} viewBox="0 0 24 24" width={width ?? 24} xmlns="http://www.w3.org/2000/svg">
			{/* A rising bar chart -- leveling's one universal visual. Same two-tone treatment as SvgModmail:
			    accent for the frame, primary for the part that reads as "progress". */}
			<rect className="stroke-misc-accent" height="12.75" strokeWidth="1.875" width="3.75" x="3.75" y="7.5" />
			<rect
				className="stroke-primary dark:stroke-primary-dark"
				height="17.25"
				strokeWidth="1.875"
				width="3.75"
				x="10.125"
				y="3"
			/>
			<rect className="stroke-misc-accent" height="8.25" strokeWidth="1.875" width="3.75" x="16.5" y="12" />
		</svg>
	);
}
