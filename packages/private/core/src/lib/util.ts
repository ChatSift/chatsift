export interface ModuleWithDefault<Type> {
	default: Type;
}

export function isModuleWithDefault<Type>(
	mod: any,
	typePredicate?: (value: any) => value is Type,
): mod is ModuleWithDefault<Type> {
	const predicateIsTrue = typePredicate ? typePredicate(mod?.default) : true;
	return mod && typeof mod === 'object' && 'default' in mod && predicateIsTrue;
}
