// Holds the current login state so the rest of the game can ask "are we logged in
// / what's my login code" without re-triggering the platform login every time.
//
// No-server note: login() only yields a short-lived code. Until a backend exists to
// exchange it for a stable openid, this just proves the login call works and gives a
// single place to later store the server-issued user id / session.

import { LoginResult, UserProfile } from './IPlatform';
import { platform } from './PlatformManager';

let _result: LoginResult | null = null;
let _pending: Promise<LoginResult | null> | null = null;
let _profile: UserProfile | null = null;
let _profilePending: Promise<UserProfile | null> | null = null;

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

// Fetch the user's profile (nickname + avatar) once and cache it. Idempotent.
// Resolves null when unavailable / not yet authorized (WeChat first-time auth needs
// a user tap on createUserInfoButton). Never rejects.
export function ensureUserProfile(): Promise<UserProfile | null> {
    if (_profile) {
        return Promise.resolve(_profile);
    }
    if (_profilePending) {
        return _profilePending;
    }
    _profilePending = platform()
        .getUserProfile()
        .then((profile) => {
            _profilePending = null;
            _profile = profile;
            return profile;
        })
        .catch((error) => {
            _profilePending = null;
            console.warn('[Platform] getUserProfile failed', error);
            return null;
        });
    return _profilePending;
}

export function getUserProfile(): UserProfile | null {
    return _profile;
}

// Interactive profile authorization (creates the native auth button on WeChat/Douyin).
// Caches the result. Call this only in response to startup/user intent, since it may
// surface a native button. Never rejects.
export function requestUserProfile(): Promise<UserProfile | null> {
    if (_profile) {
        return Promise.resolve(_profile);
    }
    return platform()
        .requestUserProfile()
        .then((profile) => {
            if (profile) {
                _profile = profile;
            }
            return profile;
        })
        .catch((error) => {
            console.warn('[Platform] requestUserProfile failed', error);
            return null;
        });
}
