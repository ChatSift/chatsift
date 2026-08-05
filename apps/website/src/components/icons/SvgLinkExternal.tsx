export function SvgLinkExternal({ width, height }: { readonly height?: number; readonly width?: number }) {
	return (
		<svg fill="none" height={height ?? 20} viewBox="0 0 25 24" width={width ?? 20} xmlns="http://www.w3.org/2000/svg">
			<path
				d="M5.33325 17.59L15.9233 7H9.33325V5H19.3333V15H17.3333V8.41L6.74325 19L5.33325 17.59Z"
				fill="currentColor"
			/>
		</svg>
	);
}
