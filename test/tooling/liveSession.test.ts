import { describe, expect, it } from 'vitest';
import { storedSession } from '../live/session';

const cookie = (name: string) => ({ name, value: `v-${name}`, domain: '.tradingview.com', path: '/', expires: 1800000000, httpOnly: true, secure: true, sameSite: 'Lax' });
const json = (...names: string[]) => JSON.stringify(names.map(cookie));

describe('live test session', () => {
  it('uses TV_SESSION_COOKIES over the session file, so CI never needs the file', () => {
    const s = storedSession(json('sessionid', 'sessionid_sign'), { text: json('sessionid', 'from_file'), name: 'file' });
    expect(s!.map((c) => c.name)).toEqual(['sessionid', 'sessionid_sign']);
  });

  it('falls back to the session file when the variable is empty, and to null when neither exists', () => {
    expect(storedSession('  ', { text: json('sessionid'), name: 'file' })!.map((c) => c.value)).toEqual(['v-sessionid']);
    expect(storedSession(undefined, null)).toBeNull();
  });

  it('names the variable when its value is not JSON', () => {
    expect(() => storedSession('sessionid=abc', null)).toThrow(/TV_SESSION_COOKIES is not JSON/);
  });

  it('refuses cookies without a TradingView session cookie instead of running signed out', () => {
    expect(() => storedSession(json('cookie_consent'), null)).toThrow(/has no sessionid cookie/);
  });

  it('refuses a value that is not a list of cookies', () => {
    expect(() => storedSession(JSON.stringify({ sessionid: 'abc' }), null)).toThrow(/not a list of cookies/);
  });
});
