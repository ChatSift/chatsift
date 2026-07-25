const ALL_PLACEHOLDERS = ['username', 'userId', 'joinDate', 'guildName'] as const;

export type TemplatePlaceholderName = (typeof ALL_PLACEHOLDERS)[number];

interface TemplatePlaceholdersHintProps {
	/**
	 * Defaults to every placeholder the greeting/farewell fields support; narrow it for fields (like
	 * the anon reply label) that only make sense with a subset.
	 */
	readonly placeholders?: readonly TemplatePlaceholderName[];
}

/**
 * Documents the `{{ name }}` placeholder syntax `services/modmail-bot`'s `lib/templateString.ts`
 * substitutes before posting text (ported from prod ChatSift/ModMail's own template syntax) — the
 * dashboard has no other way to tell an admin these exist since the fields are just plain inputs.
 */
export function TemplatePlaceholdersHint({ placeholders = ALL_PLACEHOLDERS }: TemplatePlaceholdersHintProps) {
	return (
		<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
			Supports placeholder{placeholders.length === 1 ? '' : 's'}:{' '}
			{placeholders.map((placeholder, index) => (
				<span key={placeholder}>
					<code className="rounded bg-on-secondary px-1 py-0.5 text-xs dark:bg-on-secondary-dark">
						{`{{ ${placeholder} }}`}
					</code>
					{index < placeholders.length - 1 ? ', ' : ''}
				</span>
			))}
		</p>
	);
}
