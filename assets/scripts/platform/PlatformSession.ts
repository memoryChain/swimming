// Holds the current login state so the rest of the game can ask "are we logged in
// / what's my login code" without re-triggering the platform login every time.
//
// No-server note: login() only yields a short-lived code. Until a backend exists to
// exchange it for a stable openid, this just proves the login call works and gives a
// single place to later store the server-issued user id / session.

import { LoginResult } from './IPlatform';
import { platform } from './PlatformManager';

let _result: LoginResult | null = null;
let _pending: Promise<LoginResult | null> | null = null;

// Log in once and cache the result. Safe to call repeatedly (idempotent): concurrent
// callers share one in-flight request, and later callers get the cached result.
// Never rejects — resolves null on failure so startup code doesn't need try/catch.
export function ensureLogin(): Promise<LoginResult | null> {
    if (_result) {
        return Promise.resolve(_result);
    }
    if (_pending) {
        return _pending;
    }
    _pending = platform()
        .login()
        .then((result) => {
            _pending = null;
            _result = result;
            console.log(`[Platform] login ok (${result.platform})`);
            return result;
        })
        .catch((error) => {
            _pending = null;
            console.warn('[Platform] login failed', error);
            return null;
        });
    return _pending;
}

export function getLoginResult(): LoginResult | null {
    return _result;
}

export function isLoggedIn(): boolean {
    return _result !== null;
}
