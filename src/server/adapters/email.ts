import { getConfig } from '../config';

export interface EmailMessage { to: string; subject: string; html: string; text: string; idempotencyKey: string }
export type EmailResult = { ok: true; providerId: string } | { ok: false; retryable: boolean; code: string };

export interface EmailProvider {
  readonly mode: 'real' | 'fake';
  send(msg: EmailMessage): Promise<EmailResult>;
}

/** Resend HTTP API adapter (real integration; needs RESEND_API_KEY + verified sender). */
export class ResendEmailProvider implements EmailProvider {
  readonly mode = 'real' as const;
  constructor(private apiKey: string, private from: string, private fetchImpl: typeof fetch = fetch) {}
  async send(msg: EmailMessage): Promise<EmailResult> {
    try {
      const res = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', 'idempotency-key': msg.idempotencyKey },
        body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { id?: string };
        return { ok: true, providerId: body.id ?? 'unknown' };
      }
      return { ok: false, retryable: res.status === 429 || res.status >= 500, code: `resend_${res.status}` };
    } catch {
      return { ok: false, retryable: true, code: 'resend_network' };
    }
  }
}

/**
 * Development/test double: records messages in memory, sends nothing.
 * Disallowed in production by config validation.
 */
export class FakeEmailProvider implements EmailProvider {
  readonly mode = 'fake' as const;
  readonly sent: EmailMessage[] = [];
  failNext: null | { retryable: boolean; code: string } = null;
  async send(msg: EmailMessage): Promise<EmailResult> {
    if (this.failNext) {
      const f = this.failNext;
      this.failNext = null;
      return { ok: false, ...f };
    }
    if (!this.sent.some((m) => m.idempotencyKey === msg.idempotencyKey)) this.sent.push(msg);
    return { ok: true, providerId: `fake-${this.sent.length}` };
  }
}

/** Real mode selected but RESEND_FROM_EMAIL / RESEND_API_KEY missing: fail visibly, never pretend. */
export class UnconfiguredEmailProvider implements EmailProvider {
  readonly mode = 'real' as const;
  async send(): Promise<EmailResult> {
    return { ok: false, retryable: false, code: 'not_configured' };
  }
}

const g = globalThis as unknown as { __csbEmail?: EmailProvider };

export function getEmailProvider(): EmailProvider {
  if (!g.__csbEmail) {
    const cfg = getConfig();
    if (cfg.emailProvider === 'real') {
      g.__csbEmail = cfg.resendApiKey && cfg.resendFromEmail
        ? new ResendEmailProvider(cfg.resendApiKey, cfg.resendFromEmail)
        : new UnconfiguredEmailProvider();
    } else {
      g.__csbEmail = new FakeEmailProvider();
    }
  }
  return g.__csbEmail;
}

export function setEmailProvider(p: EmailProvider) {
  g.__csbEmail = p;
}
