import { z } from 'zod';

export const BOTS = ['automoderator'] as const;
export const GeneralModuleKind = ['boolean'] as const;

export const BotKindSchema = z.enum(BOTS);
export const GeneralModuleKindSchema = z.enum(GeneralModuleKind);

export const MetaSchema = z
	.object({
		label: z.string(),
		description: z.string().nullable(),
	})
	.strict();

export const GeneralConfigModuleOptionsSchema = z
	.object({
		meta: MetaSchema,
		kind: GeneralModuleKindSchema,
	})
	.strict();

export const GeneralConfigModuleSchema = z
	.object({
		meta: MetaSchema,
		kind: z.literal('general'),
		options: z.array(GeneralConfigModuleOptionsSchema).min(1),
	})
	.strict();

export const WebhookConfigModuleOptionsSchema = z
	.object({
		meta: MetaSchema,
	})
	.strict();

export const WebhookConfigModuleSchema = z
	.object({
		meta: MetaSchema,
		kind: z.literal('webhook'),
		options: z.array(WebhookConfigModuleOptionsSchema).min(1),
	})
	.strict();

export const ConfigModuleSchema = z.union([GeneralConfigModuleSchema, WebhookConfigModuleSchema]);

export const ConfigSchema = z
	.object({
		bot: BotKindSchema,
		modules: z.array(ConfigModuleSchema),
	})
	.strict();
