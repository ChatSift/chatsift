export function SvgModmail({ width, height }: { readonly height?: number; readonly width?: number }) {
	return (
		<svg fill="none" height={height ?? 24} viewBox="0 0 24 24" width={width ?? 24} xmlns="http://www.w3.org/2000/svg">
			<rect
				className="stroke-misc-accent"
				height="12"
				strokeLinejoin="round"
				strokeWidth="1.875"
				width="15"
				x="4.5"
				y="6"
			/>
			<path
				className="stroke-primary dark:stroke-primary-dark"
				d="M8.25 9.75L12 12.75L15.75 9.75"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.875"
			/>
		</svg>
	);
}
