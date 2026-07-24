export function SvgModmail({ width, height }: { readonly height?: number; readonly width?: number }) {
	return (
		<svg fill="none" height={height ?? 24} viewBox="0 0 24 24" width={width ?? 24} xmlns="http://www.w3.org/2000/svg">
			<path
				className="stroke-misc-accent"
				d="M4.5 6H19.5V18H4.5V6Z"
				strokeLinejoin="round"
				strokeWidth="1.875"
			/>
			<path
				className="stroke-primary dark:stroke-primary-dark"
				d="M4.5 6.75L12 12.75L19.5 6.75"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.875"
			/>
		</svg>
	);
}
