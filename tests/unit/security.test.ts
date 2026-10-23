import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, bodyHash, stableStringify } from '@/server/crypto';
import { resetConfigCache } from '@/server/config';
import { safeReturnTo } from '@/modules/identity/auth';
import { charLength, likePattern } from '@/modules/shared/text';
import { safeHref } from '@/components/markdown-utils';

describe('token encryption with key rotation', () => {
  it('round trips and decrypts old ciphertext after rotation', () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    process.env.TOKEN_ENCRYPTION_KEY_VERSION = '1';
    process.env.TOKEN_ENCRYPTION_PREVIOUS_KEYS = '';
    resetConfigCache();
    const old = encryptSecret('refresh-token-value');
    expect(old.ciphertext).not.toContain('refresh-token-value');
    expect(decryptSecret(old.ciphertext)).toBe('refresh-token-value');
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 2).toString('base64');
    process.env.TOKEN_ENCRYPTION_KEY_VERSION = '2';
    process.env.TOKEN_ENCRYPTION_PREVIOUS_KEYS = `1:${Buffer.alloc(32, 1).toString('base64')}`;
    resetConfigCache();
    expect(decryptSecret(old.ciphertext)).toBe('refresh-token-value');
    const fresh = encryptSecret('new');
    expect(fresh.keyVersion).toBe(2);
    const tampered = fresh.ciphertext.slice(0, -2) + (fresh.ciphertext.endsWith('A') ? 'B' : 'A') + fresh.ciphertext.slice(-1);
    expect(() => decryptSecret(tampered)).toThrow();
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.TOKEN_ENCRYPTION_KEY_VERSION = '1';
    delete process.env.TOKEN_ENCRYPTION_PREVIOUS_KEYS;
    resetConfigCache();
  });
});

describe('input safety helpers', () => {
  it('only accepts same-site relative return paths', () => {
    expect(safeReturnTo('/products/1?x=1#y')).toBe('/products/1?x=1#y');
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '', null]) expect(safeReturnTo(bad as string)).toBe('/');
  });
  it('counts Unicode characters, escapes LIKE wildcards and hashes bodies stably', () => {
    expect(charLength('😀繁體')).toBe(3);
    expect(likePattern('50%_a\\b')).toBe('%50\\%\\_a\\\\b%');
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(bodyHash({ a: 1, b: 2 })).toBe(bodyHash({ b: 2, a: 1 }));
  });
  it('markdown links only allow http(s)/mailto', () => {
    expect(safeHref('https://example.com/x')).toBe('https://example.com/x');
    expect(safeHref('mailto:a@example.com')).toBe('mailto:a@example.com');
    for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', 'vbscript:x', ' javascript:x']) expect(safeHref(bad)).toBe('');
  });
});
