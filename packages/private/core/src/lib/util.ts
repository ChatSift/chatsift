export interface ModuleWithDefault<Type> {
	default: Type;
}

export function isModuleWithDefault<Type>(
	mod: any,
	typePredicate?: (value: any) => value is Type,
): mod is ModuleWithDefault<Type> {
	const predicateIsTrue = typePredicate ? typePredicate(mod?.default) : true;
	// `Boolean(...)` rather than returning the `&&` chain directly: a nullish `mod` short-circuits to that
	// value verbatim, which contradicts the `boolean` type predicate above.
	return Boolean(mod && typeof mod === 'object' && 'default' in mod && predicateIsTrue);
}
