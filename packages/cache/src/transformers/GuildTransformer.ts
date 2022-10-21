import type { APIGuild, GuildFeature } from 'discord-api-types/v10';
import { Reader } from '../data/Reader';
import { Writer } from '../data/Writer';
import type { ITransformer } from './ITransformer';

export type StrippedGuild = Omit<APIGuild, 'emojis' | 'region' | 'roles' | 'stickers'>;

export const guildTransformer: ITransformer<StrippedGuild> = {
	toBuffer: (guild) => {
		const writer = new Writer(200)
			.u64(guild.id)
			.u64(guild.afk_channel_id)
			.i32(guild.afk_timeout)
			.u64(guild.application_id)
			.string(guild.banner)
			.u8(guild.default_message_notifications)
			.string(guild.description)
			.string(guild.discovery_splash)
			.u8(guild.explicit_content_filter)
			.u8(guild.hub_type)
			.string(guild.icon)
			.array(guild.features, (buffer, value) => buffer.string(value))
			.u32(guild.max_members)
			.u32(guild.max_presences)
			.u32(guild.max_video_channel_users)
			.u8(guild.mfa_level)
			.string(guild.name)
			.u8(guild.nsfw_level)
			.u64(guild.owner_id)
			.string(guild.preferred_locale)
			.bool(guild.premium_progress_bar_enabled)
			.u16(guild.premium_subscription_count)
			.u8(guild.premium_tier)
			.u64(guild.public_updates_channel_id)
			.u64(guild.rules_channel_id)
			.string(guild.splash)
			.u8(guild.system_channel_flags)
			.u64(guild.system_channel_id)
			.string(guild.vanity_url_code)
			.u8(guild.verification_level)
			.u64(guild.widget_channel_id)
			.bool(guild.widget_enabled);

		return writer.dumpTrimmed();
	},
	toJSON: (data) => {
		const reader = new Reader(data);

		const decoded: StrippedGuild = {
			id: reader.u64()!.toString(),
			afk_channel_id: reader.u64()?.toString() ?? null,
			afk_timeout: reader.i32()!,
			application_id: reader.u64()?.toString() ?? null,
			banner: reader.string(),
			default_message_notifications: reader.u8()!,
			description: reader.string(),
			discovery_splash: reader.string(),
			explicit_content_filter: reader.u8()!,
			hub_type: reader.u8(),
			icon: reader.string(),
			features: reader.array((buffer) => buffer.string() as GuildFeature),
			max_members: reader.u32() ?? undefined,
			max_presences: reader.u32(),
			max_video_channel_users: reader.u32() ?? undefined,
			mfa_level: reader.u8()!,
			name: reader.string()!,
			nsfw_level: reader.u8()!,
			owner_id: reader.u64()!.toString(),
			preferred_locale: reader.string()!,
			premium_progress_bar_enabled: reader.bool()!,
			premium_subscription_count: reader.u16() ?? undefined,
			premium_tier: reader.u8()!,
			public_updates_channel_id: reader.u64()?.toString() ?? null,
			rules_channel_id: reader.u64()?.toString() ?? null,
			splash: reader.string(),
			system_channel_flags: reader.u8()!,
			system_channel_id: reader.u64()?.toString() ?? null,
			vanity_url_code: reader.string(),
			verification_level: reader.u8()!,
			widget_channel_id: reader.u64()?.toString() ?? null,
			widget_enabled: reader.bool()!,
		};

		return decoded;
	},
};
