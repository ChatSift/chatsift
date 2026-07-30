export function SnippetNamePreviewHelper({ name }: { readonly name: string }) {
	return (
		<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
			Will be usable as <span className="font-mono">/{name || '...'}</span>
		</p>
	);
}
