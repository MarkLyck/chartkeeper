import { TvClient } from '../core/tv/client';
import { TvError } from '../core/tv/errors';
import { PoliteHttp } from '../core/tv/http';
import { ElectronPageTransport, hasSessionCookie, signOut } from './tvSession';

/** The signed-in TradingView account. The only place that changes the username the window shows. */
export class TvAccount {
  readonly transport = new ElectronPageTransport();
  /** One rate limiter for every request, so a backup and the restore screen can't add up to more than one request at a time. */
  private readonly http = new PoliteHttp(this.transport);
  private name: string | null = null;

  /** The account's name, once a client was made for it this session. */
  get username(): string | null {
    return this.name;
  }

  /** A client for the signed-in account, or a plain "please sign in" error. */
  async client(): Promise<TvClient> {
    if (!(await hasSessionCookie())) throw new TvError('not-signed-in', 'You are not signed in to TradingView.');
    // A fresh page each time: the tray app may run for weeks, and the sign-in, token and build can change.
    this.transport.reset();
    const user = await this.transport.user().catch((e: unknown) => {
      throw new TvError('network', 'Could not reach TradingView. Check the internet connection and try again.', String(e));
    });
    if (!user) {
      this.transport.reset();
      throw new TvError('not-signed-in', 'TradingView does not recognise the saved sign-in any more. Please sign in again.');
    }
    this.name = user.username;
    return new TvClient(this.http, user);
  }

  async signOut(): Promise<void> {
    await signOut();
    this.transport.reset();
    this.name = null;
  }
}
