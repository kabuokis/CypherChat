
// this file is generated — do not edit it


declare module "svelte/elements" {
	export interface HTMLAttributes<T> {
		'data-sveltekit-keepfocus'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-noscroll'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-preload-code'?:
			| true
			| ''
			| 'eager'
			| 'viewport'
			| 'hover'
			| 'tap'
			| 'off'
			| undefined
			| null;
		'data-sveltekit-preload-data'?: true | '' | 'hover' | 'tap' | 'off' | undefined | null;
		'data-sveltekit-reload'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-replacestate'?: true | '' | 'off' | undefined | null;
	}
}

export {};


declare module "$app/types" {
	type MatcherParam<M> = M extends (param : string) => param is (infer U extends string) ? U : string;

	export interface AppTypes {
		RouteId(): "/" | "/chat" | "/contacts" | "/login" | "/register" | "/settings" | "/settings/2fa" | "/settings/keys" | "/settings/sessions";
		RouteParams(): {
			
		};
		LayoutParams(): {
			"/": Record<string, never>;
			"/chat": Record<string, never>;
			"/contacts": Record<string, never>;
			"/login": Record<string, never>;
			"/register": Record<string, never>;
			"/settings": Record<string, never>;
			"/settings/2fa": Record<string, never>;
			"/settings/keys": Record<string, never>;
			"/settings/sessions": Record<string, never>
		};
		Pathname(): "/" | "/chat" | "/contacts" | "/login" | "/register" | "/settings/2fa" | "/settings/keys" | "/settings/sessions";
		ResolvedPathname(): `${"" | `/${string}`}${ReturnType<AppTypes['Pathname']>}`;
		Asset(): string & {};
	}
}