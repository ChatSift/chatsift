import type { GuildChannelInfo } from '@chatsift/api';
import { ChannelType } from 'discord-api-types/v10';
import type { ComponentType } from 'react';
import { SvgChannelAnnouncement } from '../components/icons/channels/SvgChannelAnnouncement';
import { SvgChannelCategory } from '../components/icons/channels/SvgChannelCategory';
import { SvgChannelForum } from '../components/icons/channels/SvgChannelForum';
import { SvgChannelText } from '../components/icons/channels/SvgChannelText';
import { SvgChannelThread } from '../components/icons/channels/SvgChannelThread';

export function getChannelIcon(
	channelType: GuildChannelInfo['type'],
): ComponentType<{ className?: string; size?: number }> {
	switch (channelType) {
		case ChannelType.GuildCategory:
			return SvgChannelCategory;
		case ChannelType.GuildAnnouncement:
			return SvgChannelAnnouncement;
		case ChannelType.GuildForum:
			return SvgChannelForum;
		case ChannelType.PublicThread:
		case ChannelType.PrivateThread:
		case ChannelType.AnnouncementThread:
			return SvgChannelThread;
		default:
			return SvgChannelText;
	}
}

export function isTextBasedChannel(channelType: GuildChannelInfo['type']): boolean {
	return (
		channelType === ChannelType.GuildText ||
		channelType === ChannelType.GuildAnnouncement ||
		channelType === ChannelType.GuildForum ||
		channelType === ChannelType.PublicThread ||
		channelType === ChannelType.PrivateThread ||
		channelType === ChannelType.AnnouncementThread
	);
}

export function isVoiceBasedChannel(channelType: GuildChannelInfo['type']): boolean {
	return channelType === ChannelType.GuildVoice || channelType === ChannelType.GuildStageVoice;
}
