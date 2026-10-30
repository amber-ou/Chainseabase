import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { migrationChecksums } from '../../scripts/migrate-lib';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const lf = 'create table a (id int);\ncreate table b (id int);\n';
const crlf = lf.replace(/\n/g, '\r\n');

describe('WIN-01 migration checksums across Windows and Linux checkouts', () => {
  it('a database migrated from a CRLF (Windows) checkout accepts the same file checked out with LF, and vice versa', () => {
    expect(migrationChecksums(lf).accepted.has(sha256(crlf))).toBe(true);
    expect(migrationChecksums(crlf).accepted.has(sha256(lf))).toBe(true);
    // checksums recorded by earlier versions (raw bytes) still match their own checkout
    expect(migrationChecksums(crlf).accepted.has(sha256(crlf))).toBe(true);
    expect(migrationChecksums(lf).accepted.has(sha256(lf))).toBe(true);
  });

  it('new migrations record the LF form whatever the checkout', () => {
    expect(migrationChecksums(crlf).record).toBe(sha256(lf));
    expect(migrationChecksums(lf).record).toBe(sha256(lf));
  });

  it('a real content change is still detected', () => {
    const changed = lf.replace('id int', 'id bigint');
    expect(migrationChecksums(changed).accepted.has(sha256(lf))).toBe(false);
    expect(migrationChecksums(changed).accepted.has(sha256(crlf))).toBe(false);
  });
});
