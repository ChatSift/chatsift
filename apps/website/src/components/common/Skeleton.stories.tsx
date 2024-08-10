import type { Meta, StoryObj } from '@storybook/react';
import Skeleton from './Skeleton';

export default {
	title: 'Skeleton',
	component: Skeleton,
	tags: ['autodocs'],
} satisfies Meta<typeof Skeleton>;

type Story = StoryObj<typeof Skeleton>;

export const Default = {
	render: ({ ...args }) => <Skeleton {...args} />,
	args: {
		className: 'h-12',
	},
} satisfies Story;
