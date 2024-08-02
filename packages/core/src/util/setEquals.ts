export function setEquals<Type>(a: Set<Type>, b: Set<Type>): boolean {
	if (a.size !== b.size) {
		return false;
	}

	for (const aItem of a) {
		if (!b.has(aItem)) {
			return false;
		}
	}

	return true;
}
