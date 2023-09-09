/**
 * Transforms a class constructor type into a factory function type.
 *
 * @example
 * ```ts
 * class Foo {
 *		public constructor(public readonly bar: string) {}
 *
 *		public baz(): string {
 *			return this.bar;
 *		}
 * }
 *
 * type FooFactory = FactoryFrom<typeof Foo>;
 *
 * // elsewhere
 * class Bar {
 *		public constructor(public readonly fooFactory: FooFactory) {}
 *
 *		public doSomething(): void {
 *			const foo = this.fooFactory('hello');
 *			console.log(foo.baz());
 *		}
 * }
 * ```
 */
export type FactoryFrom<TConstructor extends new (...args: any[]) => any> = TConstructor extends new (
	...args: infer TArgs
) => infer TInstance
	? (...args: TArgs) => TInstance
	: never;
