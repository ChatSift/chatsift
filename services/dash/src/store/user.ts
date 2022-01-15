import create, { State } from 'zustand';
import type { Snowflake } from 'discord-api-types/v9';

export interface UserPayload {
	loggedIn: boolean | null;
	id: Snowflake | null;
	username: string | null;
	discriminator: string | null;
	avatar: string | null;
	guilds: { id: Snowflake; name: string; icon: string | null }[] | null;
}

export interface UserState extends State, UserPayload {
	login: () => void;
	logout: () => void;
	setUser: (user: UserPayload) => void;
}

export const useUserStore = create<UserState>((set) => ({
	loggedIn: null,
	id: null,
	username: null,
	discriminator: null,
	avatar: null,
	guilds: null,
	login: () => set(() => ({ loggedIn: true })),
	logout: () => set(() => ({ loggedIn: false })),
	setUser: (payload: UserPayload) => set(() => payload),
}));
