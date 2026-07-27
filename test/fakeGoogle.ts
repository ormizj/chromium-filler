/**
 * A fake Google, so the sync feature can be tested without one.
 *
 * `googleAuth.ts`, `drive.ts` and `sync.ts` are the only part of the extension
 * that talks to a network, and between them they hold the auth flow, the Drive
 * client and the compare-and-swap that stops two devices overwriting each
 * other. None of it could be tested: the `chrome.*` mock has no `identity`, so
 * the modules could not even be imported.
 *
 * This stands in for both halves — `chrome.identity` and `fetch` — with an
 * in-memory app folder behind them. It is deliberately a *strict* fake rather
 * than a stub that says yes:
 *
 * - **PKCE is really verified.** The token exchange re-hashes the `code_verifier`
 *   and compares it against the challenge the authorization request sent, so a
 *   broken S256 implementation fails here rather than at Google.
 * - **Access tokens really expire**, and Drive really answers `401` to a stale
 *   one. That is what makes the refresh path and its absence of a retry visible.
 * - **`version` really bumps on every write**, which is the token the
 *   compare-and-swap turns on. A concurrent writer can be simulated with
 *   `beforeUpload`, so a lost race is a real lost race.
 *
 * Failures are injected by setting a field, never by re-mocking `fetch` in a
 * test — the routing has to stay in one place or the requests stop being
 * checked.
 */

import { vi } from 'vitest';

/** The redirect URI `chrome.identity.getRedirectURL()` hands out. */
export const REDIRECT_URI = 'https://cffakeextensionid.chromiumapp.org/';

/** The authorization code the consent screen "returns". */
const AUTH_CODE = 'fake-auth-code';

export interface DriveFile {
  id: string;
  name: string;
  /** Drive's change counter, as a string — which is how the real API sends it. */
  version: number;
  content: string;
  parents: string[];
  trashed: boolean;
}

/** One request the fake saw, kept so tests can assert on what was sent. */
export interface SeenRequest {
  method: string;
  url: string;
  headers: Headers;
  body?: string;
}

/** How the consent window behaves. */
export type AuthFlowOutcome =
  | { kind: 'code' }
  | { kind: 'error'; error: string }
  /** What MV3 really does when the user closes the window: the promise rejects. */
  | { kind: 'reject'; message: string };

/** An injected token-endpoint failure. */
export interface TokenFailure {
  status?: number;
  /** A JSON error body, the way Google reports a dead refresh token. */
  error?: string;
  /** A non-JSON body — a proxy's HTML 502, which `res.json()` chokes on. */
  rawBody?: string;
  /** `fetch` itself rejecting, i.e. the machine is offline. */
  offline?: boolean;
}

function base64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  let bin = '';
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b);
  return base64url(bin);
}

/** An unsigned JWT carrying just the claim the extension reads. */
export function idTokenFor(email: string): string {
  return `${base64url('{"alg":"none"}')}.${base64url(JSON.stringify({ email }))}.sig`;
}

interface Resp {
  ok: boolean;
  status: number;
  headers: Headers;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

function respond(status: number, body: string, headers: Record<string, string> = {}): Resp {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

function jsonRes(status: number, value: unknown, headers?: Record<string, string>): Resp {
  return respond(status, JSON.stringify(value), headers);
}

/** Google's error envelope, which `drive.ts` digs a message out of. */
function driveError(status: number, message: string): Resp {
  return jsonRes(status, { error: { code: status, message } });
}

export class FakeGoogle {
  /** The app folder. Public so a test can seed or inspect it directly. */
  files: DriveFile[] = [];

  /** Every request seen, in order. */
  readonly authFlows: URLSearchParams[] = [];
  readonly tokenCalls: Record<string, string>[] = [];
  readonly driveCalls: SeenRequest[] = [];

  /* --- knobs --- */
  authFlow: AuthFlowOutcome = { kind: 'code' };
  tokenFailure?: TokenFailure;
  /** Omit the id_token, i.e. an account whose email never arrives. */
  withIdToken = true;
  email = 'someone@example.com';
  /** Seconds the issued access token lasts. */
  expiresIn = 3600;
  /** Refuse the refresh token the client presents (consent revoked). */
  revokedRefreshTokens = new Set<string>();
  /** Runs immediately before an upload lands — for simulating the other device. */
  beforeUpload?: () => void | Promise<void>;
  /**
   * Runs before each `files.list`, with a 1-based count of how many there have
   * been. This is where a competing write has to land to be *caught*: the
   * compare-and-swap re-reads the version immediately before the PATCH, so a
   * writer arriving after that re-read is inside the millisecond window the
   * client documents as accepted, not a conflict it can see.
   */
  beforeList?: (nth: number) => void | Promise<void>;

  private challenge?: string;
  private listCount = 0;
  private nextToken = 1;
  private nextFileId = 1;
  private nextVersion = 1;
  /** Access tokens the fake has issued, and when each dies. */
  private issued = new Map<string, number>();
  private realFetch?: typeof globalThis.fetch;
  private now = () => Date.now();

  /** The refresh token issued to the current connection. */
  refreshToken = 'fake-refresh-token';

  /* ------------------------------------------------------------------ */

  install(): void {
    this.realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => this.route(input, init),
    ) as unknown as typeof globalThis.fetch;

    // @ts-expect-error the mock only carries the two methods sync uses
    globalThis.chrome.identity = {
      getRedirectURL: vi.fn(() => REDIRECT_URI),
      launchWebAuthFlow: vi.fn((opts: { url: string }) => this.consent(opts.url)),
    };
  }

  uninstall(): void {
    if (this.realFetch) globalThis.fetch = this.realFetch;
    // @ts-expect-error removing the mock again
    delete globalThis.chrome.identity;
  }

  /** Seed the app folder with a file the far side already wrote. */
  seed(content: string, name = 'jobs.json'): DriveFile {
    const file: DriveFile = {
      id: `file-${this.nextFileId++}`,
      name,
      version: this.nextVersion++,
      content,
      parents: ['appDataFolder'],
      trashed: false,
    };
    this.files.push(file);
    return file;
  }

  /** The one file's content, for asserting what was written. */
  get stored(): string | undefined {
    return this.files.find((f) => !f.trashed)?.content;
  }

  /** Expire every access token issued so far, without touching the refresh token. */
  expireAccessTokens(): void {
    for (const key of this.issued.keys()) this.issued.set(key, 0);
  }

  /* --- the consent window --- */

  private async consent(url: string): Promise<string> {
    const params = new URL(url).searchParams;
    this.authFlows.push(params);
    this.challenge = params.get('code_challenge') ?? undefined;

    const redirectUri = params.get('redirect_uri') ?? REDIRECT_URI;
    if (this.authFlow.kind === 'reject') throw new Error(this.authFlow.message);
    if (this.authFlow.kind === 'error') {
      return `${redirectUri}?error=${encodeURIComponent(this.authFlow.error)}`;
    }
    return `${redirectUri}?code=${AUTH_CODE}`;
  }

  /* --- routing --- */

  private async route(input: RequestInfo | URL, init?: RequestInit): Promise<Resp> {
    const url = typeof input === 'string' ? input : String(input);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return this.token(init);
    }
    const seen: SeenRequest = {
      method,
      url,
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    this.driveCalls.push(seen);

    const auth = this.checkAuth(seen);
    if (auth) return auth;

    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      return this.upload(seen);
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files')) {
      if (method !== 'GET') return driveError(405, 'Method not allowed');
      if (new URL(url).searchParams.get('alt') !== 'media') {
        await this.beforeList?.(++this.listCount);
      }
      return this.filesGet(seen);
    }
    throw new Error(`FakeGoogle: nothing is listening at ${method} ${url}`);
  }

  /* --- OAuth --- */

  private async token(init?: RequestInit): Promise<Resp> {
    const body = Object.fromEntries(
      new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
    ) as Record<string, string>;
    this.tokenCalls.push(body);

    const fail = this.tokenFailure;
    if (fail) {
      if (fail.offline) throw new TypeError('Failed to fetch');
      if (fail.rawBody !== undefined) return respond(fail.status ?? 502, fail.rawBody);
      return jsonRes(fail.status ?? 400, { error: fail.error ?? 'invalid_request' });
    }

    if (body.grant_type === 'authorization_code') {
      if (body.code !== AUTH_CODE) return jsonRes(400, { error: 'invalid_grant' });
      // PKCE, checked rather than assumed.
      const verifier = body.code_verifier ?? '';
      if (!this.challenge || (await challengeFor(verifier)) !== this.challenge) {
        return jsonRes(400, { error: 'invalid_grant', error_description: 'code_verifier mismatch' });
      }
      return jsonRes(200, {
        access_token: this.issueAccess(),
        refresh_token: this.refreshToken,
        expires_in: this.expiresIn,
        ...(this.withIdToken ? { id_token: idTokenFor(this.email) } : {}),
      });
    }

    if (body.grant_type === 'refresh_token') {
      if (this.revokedRefreshTokens.has(body.refresh_token ?? '')) {
        return jsonRes(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      }
      if (body.refresh_token !== this.refreshToken) {
        return jsonRes(400, { error: 'invalid_grant' });
      }
      return jsonRes(200, {
        access_token: this.issueAccess(),
        expires_in: this.expiresIn,
        ...(this.withIdToken ? { id_token: idTokenFor(this.email) } : {}),
      });
    }

    return jsonRes(400, { error: 'unsupported_grant_type' });
  }

  private issueAccess(): string {
    const token = `access-${this.nextToken++}`;
    this.issued.set(token, this.now() + this.expiresIn * 1000);
    return token;
  }

  /** Drive's answer to a token that is missing, unknown, or past its life. */
  private checkAuth(req: SeenRequest): Resp | undefined {
    const header = req.headers.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const expiry = this.issued.get(token);
    if (!token || expiry === undefined) return driveError(401, 'Invalid Credentials');
    if (expiry <= this.now()) return driveError(401, 'Invalid Credentials');
    return undefined;
  }

  /* --- Drive --- */

  private filesGet(req: SeenRequest): Resp {
    const url = new URL(req.url);
    const media = url.searchParams.get('alt') === 'media';
    const path = url.pathname.replace('/drive/v3/files', '');

    if (media || path.length > 1) {
      const id = path.replace(/^\//, '');
      const file = this.files.find((f) => f.id === id && !f.trashed);
      if (!file) return driveError(404, 'File not found');
      return respond(200, file.content);
    }

    // A list. The real API filters by the `q` we send; matching on the name is
    // enough to make `pageSize` and the duplicate case behave truthfully.
    const q = url.searchParams.get('q') ?? '';
    const name = /name = '([^']+)'/.exec(q)?.[1];
    const size = Number(url.searchParams.get('pageSize') ?? '100');
    const matches = this.files
      .filter((f) => !f.trashed && (!name || f.name === name))
      .slice(0, size)
      .map((f) => ({ id: f.id, version: String(f.version) }));
    // A list response may carry an ETag, and it describes *the query result* —
    // not any file in it. Sent here because the client used to read it and
    // replay it as a file precondition, which only ever worked by being ignored.
    return jsonRes(200, { files: matches }, { etag: `"list-${this.nextVersion}"` });
  }

  private async upload(req: SeenRequest): Promise<Resp> {
    await this.beforeUpload?.();
    const url = new URL(req.url);
    const type = url.searchParams.get('uploadType');

    if (req.method === 'POST' && type === 'multipart') {
      const ct = req.headers.get('content-type') ?? '';
      const boundary = /boundary=(.+)$/.exec(ct)?.[1];
      if (!boundary) return driveError(400, 'Missing multipart boundary');
      const parts = (req.body ?? '')
        .split(`--${boundary}`)
        .map((p) => p.replace(/\r\n$/, ''))
        .filter((p) => p.trim() && p.trim() !== '--');
      const bodies = parts.map((p) => p.split('\r\n\r\n').slice(1).join('\r\n\r\n'));
      const metadata = JSON.parse(bodies[0]) as { name: string; parents?: string[] };
      const file: DriveFile = {
        id: `file-${this.nextFileId++}`,
        name: metadata.name,
        version: this.nextVersion++,
        content: bodies[1] ?? '',
        parents: metadata.parents ?? [],
        trashed: false,
      };
      this.files.push(file);
      return jsonRes(200, { id: file.id, version: String(file.version) });
    }

    if (req.method === 'PATCH' && type === 'media') {
      const id = url.pathname.replace('/upload/drive/v3/files/', '');
      const file = this.files.find((f) => f.id === id && !f.trashed);
      if (!file) return driveError(404, 'File not found');
      const ifMatch = req.headers.get('if-match');
      // `*` means "as long as it exists". Anything else is a real precondition,
      // and the fake holds the code to it.
      if (ifMatch && ifMatch !== '*' && ifMatch !== `"${file.version}"`) {
        return driveError(412, 'Precondition Failed');
      }
      file.content = req.body ?? '';
      file.version = this.nextVersion++;
      return jsonRes(200, { id: file.id, version: String(file.version) });
    }

    return driveError(400, `Unsupported upload ${req.method} ${type}`);
  }
}
