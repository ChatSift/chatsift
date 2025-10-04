export function SvgAutoModerator({ width, height }: { readonly height?: number; readonly width?: number }) {
	return (
		<svg fill="none" height={height ?? 24} viewBox="0 0 24 24" width={width ?? 24} xmlns="http://www.w3.org/2000/svg">
			<path
				className="stroke-misc-accent"
				d="M4.5 4.5V15L12 21L19.5 15V4.5H4.5Z"
				strokeLinejoin="round"
				strokeWidth="1.875"
			/>
			<path
				className="fill-primary stroke-primary dark:fill-primary-dark dark:stroke-primary-dark"
				d="M9 9V12.8182L12 15L15 12.8182V9H9Z"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.875"
			/>
		</svg>
	);
}
