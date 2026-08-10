import {
  buildStorageKey,
  generatePin,
  hashSecret,
  verifySecret,
} from './secrets';

describe('generatePin', () => {
  it('always returns 4 digits, leading zeros included', () => {
    for (let i = 0; i < 1000; i += 1) {
      expect(generatePin()).toMatch(/^\d{4}$/);
    }
  });
});

describe('hashSecret / verifySecret', () => {
  it('produces an argon2id PHC string with the OWASP parameters', async () => {
    const hash = await hashSecret('TestPassword');
    expect(hash.startsWith('$argon2id$v=19$')).toBe(true);
    // Asserted parameter by parameter rather than against the whole string:
    // the library writes them in m,p,t order, which has no reason to stay
    // stable across versions. What must stay stable are the values.
    const parameters = hash.split('$')[3];
    expect(parameters).toContain('m=19456');
    expect(parameters).toContain('t=2');
    expect(parameters).toContain('p=1');
  });

  it('never stores the value in clear', async () => {
    const hash = await hashSecret('TestPassword');
    expect(hash).not.toContain('TestPassword');
  });

  it('accepts the right value and rejects a wrong one', async () => {
    const hash = await hashSecret('0042');
    await expect(verifySecret('0042', hash)).resolves.toBe(true);
    await expect(verifySecret('0043', hash)).resolves.toBe(false);
  });

  it('tells "0042" from "42": the PIN is a string, not a number', async () => {
    const hash = await hashSecret('0042');
    await expect(verifySecret('42', hash)).resolves.toBe(false);
  });

  it('returns false on an unreadable hash instead of throwing', async () => {
    // Throwing here would surface as a 500, where a wrong PIN returns an
    // authentication error: enough to tell the two cases apart from outside.
    await expect(verifySecret('0042', 'not-a-hash')).resolves.toBe(false);
    await expect(verifySecret('0042', '')).resolves.toBe(false);
  });
});

describe('buildStorageKey', () => {
  const requestId = 'req-1';
  const itemId = 'item-1';

  it('prefixes by request, then by item', () => {
    expect(buildStorageKey(requestId, itemId, 'contract.pdf')).toMatch(
      /^requests\/req-1\/items\/item-1\//,
    );
  });

  it('neutralises path traversal attempts', () => {
    const key = buildStorageKey(requestId, itemId, '../../../etc/passwd');
    expect(key).not.toContain('..');
    expect(key.startsWith(`requests/${requestId}/items/${itemId}/`)).toBe(true);
    // The only separators left are the ones from the prefix we built.
    expect(key.split('/')).toHaveLength(5);
  });

  it('strips separators and control characters', () => {
    const key = buildStorageKey(requestId, itemId, 'a/b\\c d.pdf');
    const name = key.split('/').pop() ?? '';
    expect(name).toMatch(/^[0-9a-f]{16}-[A-Za-z0-9._-]+$/);
  });

  it('falls back to a default name when nothing usable is left', () => {
    const key = buildStorageKey(requestId, itemId, '...');
    expect(key.endsWith('-file')).toBe(true);
  });

  it('cannot produce the same key twice for the same name', () => {
    const first = buildStorageKey(requestId, itemId, 'contract.pdf');
    const second = buildStorageKey(requestId, itemId, 'contract.pdf');
    expect(first).not.toBe(second);
  });
});
