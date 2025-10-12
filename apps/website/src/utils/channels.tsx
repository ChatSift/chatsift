import { ChannelType } from 'discord-api-types/v10';
import type { ComponentType } from 'react';
import { SvgChannelAnnouncement } from '../components/icons/channels/SvgChannelAnnouncement';
import { SvgChannelCategory } from '../components/icons/channels/SvgChannelCategory';
import { SvgChannelForum } from '../components/icons/channels/SvgChannelForum';
import { SvgChannelText } from '../components/icons/channels/SvgChannelText';
import { SvgChannelThread } from '../components/icons/channels/SvgChannelThread';

function Oops() {
	return <>oops, someone forgot to make an icon for this</>;
}

export function getChannelIcon(channelType: ChannelType): ComponentType<{ className?: string; size?: number }> {
	switch (channelType) {
		case ChannelType.GuildText:
			return SvgChannelText;
		case ChannelType.DM:
			return Oops;
		case ChannelType.GuildVoice:
			return Oops;
		case ChannelType.GroupDM:
			return Oops;
		case ChannelType.GuildCategory:
			return SvgChannelCategory;
		case ChannelType.GuildAnnouncement:
			return SvgChannelAnnouncement;
		case ChannelType.AnnouncementThread:
		case ChannelType.PublicThread:
		case ChannelType.PrivateThread:
			return SvgChannelThread;
		case ChannelType.GuildStageVoice:
			return Oops;
		case ChannelType.GuildDirectory:
			return Oops;
		case ChannelType.GuildForum:
			return SvgChannelForum;
		case ChannelType.GuildMedia:
			return Oops;
		default:
			return Oops;
	}
}

export function isTextBasedChannel(channelType: ChannelType): boolean {
	return (
		channelType === ChannelType.GuildText ||
		channelType === ChannelType.GuildAnnouncement ||
		channelType === ChannelType.GuildForum ||
		channelType === ChannelType.PublicThread ||
		channelType === ChannelType.PrivateThread ||
		channelType === ChannelType.AnnouncementThread
	);
}

export function isVoiceBasedChannel(channelType: ChannelType): boolean {
	return channelType === ChannelType.GuildVoice || channelType === ChannelType.GuildStageVoice;
}
