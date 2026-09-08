export function SvgAppeals({ width, height }: { readonly height?: number; readonly width?: number }) {
	return (
		<svg fill="none" height={height ?? 24} viewBox="0 0 24 24" width={width ?? 24} xmlns="http://www.w3.org/2000/svg">
			<rect
				className="stroke-misc-accent"
				height="9"
				strokeLinejoin="round"
				strokeWidth="1.875"
				width="13.5"
				x="5.25"
				y="10.5"
			/>
			<path
				className="stroke-misc-accent"
				d="M9 10.5V7.5C9 5.84315 10.3431 4.5 12 4.5C13.6569 4.5 15 5.84315 15 7.5"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.875"
			/>
			<path
				className="stroke-primary dark:stroke-primary-dark"
				d="M12 13.5V16.5"
				strokeLinecap="round"
				strokeWidth="1.875"
			/>
		</svg>
	);
}
