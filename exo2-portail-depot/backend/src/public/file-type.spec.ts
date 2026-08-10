import { detectFileType } from './file-type';

/**
 * What this suite protects: the allowlist cannot be bypassed by lying about a
 * header. Every case below is a payload whose declared type would have been
 * accepted and whose bytes say otherwise.
 */
describe('detectFileType', () => {
  it.each([
    ['application/pdf', Buffer.from('%PDF-1.7\n')],
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    [
      'image/png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ],
  ])('recognises %s from its signature alone', (expected, bytes) => {
    expect(detectFileType(bytes)).toBe(expected);
  });

  it('refuses a payload whose declared type contradicts its bytes', () => {
    // The real failure: an .exe renamed .pdf, sent with
    // Content-Type: application/pdf. Trusting either would have the lawyer
    // download a Windows binary believing they open a contract.
    const executable = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);

    expect(detectFileType(executable)).toBeNull();
  });

  it('refuses a file whose signature appears later than the first byte', () => {
    // A polyglot: valid ZIP up front, "%PDF-" further in. Scanning anywhere in
    // the payload rather than at offset 0 would accept it.
    const polyglot = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('%PDF-1.7'),
    ]);

    expect(detectFileType(polyglot)).toBeNull();
  });

  it('refuses a payload shorter than the signature it starts like', () => {
    // "%PD" alone must not be read as a PDF: the comparison has to see the
    // whole signature, not run off the end of a truncated buffer.
    expect(detectFileType(Buffer.from('%PD'))).toBeNull();
  });

  it('refuses an empty payload', () => {
    // A multipart part with no bytes: `every` over an empty prefix is true, so
    // a length check is the only thing standing between this and a 201.
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
  });

  it('refuses a JPEG whose third byte is wrong', () => {
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0x00, 0xe0]))).toBeNull();
  });
});
