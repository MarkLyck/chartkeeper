import { z } from 'zod';
import { SESSION_COOKIE } from '../../src/core/tv/endpoints';
import type { CdpCookie } from '../../src/main/browserSignIn';

const CookiesSchema = z
  .array(
    z.looseObject({
      name: z.string(),
      value: z.string(),
      domain: z.string(),
      path: z.string(),
      expires: z.number(),
      httpOnly: z.boolean(),
      secure: z.boolean(),
      sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
    }),
  )
  .min(1);

/**
 * The saved TradingView session for the live test: the TV_SESSION_COOKIES
 * value (a CI secret) when set, else the session file from an earlier local
 * sign-in, else null. Both hold the JSON list of cookies the sign-in returned.
 */
export function storedSession(env: string | undefined, file: { text: string; name: string } | null): CdpCookie[] | null {
  const source = env?.trim() ? { text: env, name: 'TV_SESSION_COOKIES' } : file;
  if (!source) return null;
  let value: unknown;
  try {
    value = JSON.parse(source.text);
  } catch {
    throw new Error(`${source.name} is not JSON. It must hold the contents of .test-output/live-session.json.`);
  }
  const r = CookiesSchema.safeParse(value);
  if (!r.success) throw new Error(`${source.name} is not a list of cookies like .test-output/live-session.json: ${r.error.issues[0]?.message}`);
  if (!r.data.some((c) => c.name === SESSION_COOKIE)) throw new Error(`${source.name} has no ${SESSION_COOKIE} cookie, so it is not a signed-in TradingView session.`);
  return r.data;
}
