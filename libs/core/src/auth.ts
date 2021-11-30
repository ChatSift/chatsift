export interface AuthGetDiscordQuery {
  redirect_uri: string;
}

export interface AuthGetDiscordCallbackQuery {
  code: string;
  state: string;
}

export interface AuthGetDiscordLogoutQuery {
  redirect_uri: string;
}

export interface AuthGetDiscordRefreshBody {
  refresh_token: string;
}
