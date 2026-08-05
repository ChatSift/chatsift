interface LegalSectionProps {
	readonly children: React.ReactNode;
	readonly title: string;
}

/**
 * Consistent heading/body styling for a single section of the Terms/Privacy pages -- `[&_x]` selectors here
 * (rather than styling every `<p>`/`<ul>`/`<a>` inline in the page files) are what let those pages be authored as
 * plain semantic HTML instead of a custom paragraph/list component for every line of legal copy.
 */
export function LegalSection({ title, children }: LegalSectionProps) {
	return (
		<section className="flex flex-col gap-3">
			<h2 className="text-xl font-medium text-primary dark:text-primary-dark">{title}</h2>
			<div className="flex flex-col gap-3 text-secondary [&_a]:underline [&_a]:underline-offset-2 [&_li]:leading-relaxed [&_p]:leading-relaxed [&_strong]:text-primary [&_ul]:flex [&_ul]:flex-col [&_ul]:list-disc [&_ul]:gap-1.5 [&_ul]:pl-6 dark:text-secondary-dark dark:[&_strong]:text-primary-dark">
				{children}
			</div>
		</section>
	);
}
