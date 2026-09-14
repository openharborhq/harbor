export * from "./password";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";

/**
 * The bundle format (spec §10.2, §10.10).
 *
 * One zip, **stored not deflated** — scans and PDFs are already compressed, so deflate would
 * spend CPU on both ends for nothing — and that zip is then sealed *whole*. The archive has to be
 * inside the seal rather than around it: a zip of separately encrypted entries leaves the
 * filenames in the clear, and a list of filenames is most of what a document is about.
 *
 * The seal is **chunked**, not one GCM tag over the whole file. A single tag would force the
 * recipient's browser to hold a 200 MB bundle in memory before anything verified, and Web
 * Crypto's one-shot `decrypt` cannot do better. Chunks let both sinks stream.
 *
 *   magic "HBRS1" (5) | chunkSize u32be | plaintextLength u64be | chunk* | zero padding
 *   chunk := iv(12) | tag(16) | ciphertext(≤ chunkSize)
 *
 * Every chunk is sealed with the header and its own index as additional data, so a chunk cannot
 * be reordered, dropped, or lifted into another bundle, and the length in the header cannot be
 * edited without every tag failing. Padding is appended *after* the last chunk — the header says
 * how much plaintext there is, so a reader stops on its own and never sees the zeros. Padding the
 * zip instead would push the archive's end-of-directory record out of reach of most unzippers.
 */
export const BUNDLE_MAGIC = Buffer.from("HBRS1", "ascii");
export const BUNDLE_CHUNK_SIZE = 1024 * 1024;
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const BUNDLE_HEADER_BYTES = BUNDLE_MAGIC.length + 4 + 8;

export function bundleHeader(plaintextLength: number, chunkSize = BUNDLE_CHUNK_SIZE): Buffer {
  const head = Buffer.alloc(BUNDLE_HEADER_BYTES);
  BUNDLE_MAGIC.copy(head, 0);
  head.writeUInt32BE(chunkSize, BUNDLE_MAGIC.length);
  head.writeBigUInt64BE(BigInt(plaintextLength), BUNDLE_MAGIC.length + 4);
  return head;
}

/** Additional data for chunk `index`: the whole header, plus where this chunk sits. */
function chunkAad(header: Buffer, index: number): Buffer {
  const aad = Buffer.alloc(header.length + 8);
  header.copy(aad, 0);
  aad.writeBigUInt64BE(BigInt(index), header.length);
  return aad;
}

export function sealChunk(key: Buffer, header: Buffer, index: number, plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(chunkAad(header, index));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function openChunk(key: Buffer, header: Buffer, index: number, sealed: Buffer): Buffer {
  if (sealed.length < IV_BYTES + TAG_BYTES) throw new Error("Bundle chunk is truncated");
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, IV_BYTES));
  decipher.setAAD(chunkAad(header, index));
  decipher.setAuthTag(sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(sealed.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}

/** Total sealed size, before padding, for a given plaintext length. */
export function sealedLength(plaintextLength: number, chunkSize = BUNDLE_CHUNK_SIZE): number {
  const chunks = Math.max(1, Math.ceil(plaintextLength / chunkSize));
  return BUNDLE_HEADER_BYTES + chunks * (IV_BYTES + TAG_BYTES) + plaintextLength;
}

/**
 * Seal a plaintext file into a bundle, padded up to `padTo` with zeros.
 *
 * Returns the true sealed length so the reader knows where the content stops; the file on disk is
 * `padTo` bytes, which is the only size anyone else gets to see.
 */
export async function sealBundle(opts: {
  source: AsyncIterable<Buffer>;
  plaintextLength: number;
  dest: FileHandle;
  key: Buffer;
  padTo: number;
  chunkSize?: number;
}): Promise<{ sealedBytes: number; paddedBytes: number }> {
  const chunkSize = opts.chunkSize ?? BUNDLE_CHUNK_SIZE;
  const header = bundleHeader(opts.plaintextLength, chunkSize);
  await opts.dest.write(header);

  let written = header.length;
  let index = 0;
  let pending: Buffer[] = [];
  let pendingBytes = 0;

  const flush = async (final: boolean) => {
    while (pendingBytes >= chunkSize || (final && pendingBytes > 0)) {
      const take = Math.min(chunkSize, pendingBytes);
      const joined = Buffer.concat(pending, pendingBytes);
      const sealed = sealChunk(opts.key, header, index++, joined.subarray(0, take));
      await opts.dest.write(sealed);
      written += sealed.length;
      const rest = joined.subarray(take);
      pending = rest.length ? [rest] : [];
      pendingBytes = rest.length;
      if (final && pendingBytes === 0) break;
    }
  };

  for await (const chunk of opts.source) {
    pending.push(chunk);
    pendingBytes += chunk.length;
    if (pendingBytes >= chunkSize) await flush(false);
  }
  await flush(true);
  // A zero-length bundle still gets one chunk, so the reader's loop is the same either way.
  if (index === 0) {
    const sealed = sealChunk(opts.key, header, 0, Buffer.alloc(0));
    await opts.dest.write(sealed);
    written += sealed.length;
  }

  if (written > opts.padTo) throw new Error(`Sealed bundle is ${written} bytes, larger than its padded size ${opts.padTo}`);
  const PAD_BLOCK = 1024 * 1024;
  const zeros = Buffer.alloc(Math.min(PAD_BLOCK, opts.padTo - written));
  let remaining = opts.padTo - written;
  while (remaining > 0) {
    const slice = remaining >= zeros.length ? zeros : zeros.subarray(0, remaining);
    await opts.dest.write(slice);
    remaining -= slice.length;
  }
  return { sealedBytes: written, paddedBytes: opts.padTo };
}

/**
 * Plaintext stream of a sealed bundle. Chunks verify as they go, so a tampered bundle fails
 * partway rather than at the very end — and nothing but one chunk is ever held in memory.
 */
export function openBundleStream(key: Buffer, read: (offset: number, length: number) => Promise<Buffer>): Readable {
  return Readable.from(
    (async function* () {
      const header = await read(0, BUNDLE_HEADER_BYTES);
      if (!header.subarray(0, BUNDLE_MAGIC.length).equals(BUNDLE_MAGIC)) throw new Error("Not a Harbor bundle");
      const chunkSize = header.readUInt32BE(BUNDLE_MAGIC.length);
      const plaintextLength = Number(header.readBigUInt64BE(BUNDLE_MAGIC.length + 4));
      const chunks = Math.max(1, Math.ceil(plaintextLength / chunkSize));

      let offset = BUNDLE_HEADER_BYTES;
      let left = plaintextLength;
      for (let i = 0; i < chunks; i++) {
        const body = Math.min(chunkSize, left);
        yield openChunk(key, header, i, await read(offset, IV_BYTES + TAG_BYTES + body));
        offset += IV_BYTES + TAG_BYTES + body;
        left -= body;
      }
    })(),
  );
}

/* ------------------------------------------------------------------ *
 * Stored zip
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(buf: Buffer, seed = 0): number {
  let c = ~seed;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const ZIP_MAX = 0xffffffff;

interface ZipEntry {
  name: Buffer;
  crc: number;
  size: number;
  offset: number;
}

/**
 * Minimal zip writer, stored method only, writing to a seekable file.
 *
 * No library, deliberately: this is the one place plaintext documents pass through on their way
 * out of the vault, and a dependency there is a dependency with its hands on everything a share
 * contains. Sizes are known up front from `document_files.byte_size`, but the CRC is not, so each
 * local header is written with a placeholder and patched once its entry is on disk. That keeps
 * the archive free of data descriptors and readable by every unzipper, including the one built
 * into Windows.
 */
export class StoredZipWriter {
  private readonly entries: ZipEntry[] = [];
  private offset = 0;

  constructor(
    private readonly file: FileHandle,
    private readonly modified: Date,
  ) {}

  get bytesWritten(): number {
    return this.offset;
  }

  async addFile(name: string, source: AsyncIterable<Buffer>): Promise<void> {
    const nameBuf = Buffer.from(name, "utf8");
    const headerOffset = this.offset;
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(dosTime(this.modified), 10);
    local.writeUInt16LE(dosDate(this.modified), 12);
    // crc, sizes patched after the data is on disk
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    await this.write(local);

    let crc = 0;
    let size = 0;
    for await (const chunk of source) {
      crc = crc32(chunk, crc);
      size += chunk.length;
      await this.write(chunk);
    }
    if (size > ZIP_MAX) throw new Error(`"${name}" is larger than 4 GB, which this archive format cannot hold`);

    const patch = Buffer.alloc(12);
    patch.writeUInt32LE(crc, 0);
    patch.writeUInt32LE(size, 4);
    patch.writeUInt32LE(size, 8);
    await this.file.write(patch, 0, patch.length, headerOffset + 14);

    this.entries.push({ name: nameBuf, crc, size, offset: headerOffset });
  }

  /** Central directory and end record. The archive is complete once this resolves. */
  async finish(): Promise<number> {
    const start = this.offset;
    for (const e of this.entries) {
      const central = Buffer.alloc(46 + e.name.length);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4); // version made by
      central.writeUInt16LE(20, 6); // version needed
      central.writeUInt16LE(0x0800, 8);
      central.writeUInt16LE(0, 10); // stored
      central.writeUInt16LE(dosTime(this.modified), 12);
      central.writeUInt16LE(dosDate(this.modified), 14);
      central.writeUInt32LE(e.crc, 16);
      central.writeUInt32LE(e.size, 20);
      central.writeUInt32LE(e.size, 24);
      central.writeUInt16LE(e.name.length, 28);
      central.writeUInt32LE(e.offset, 42);
      e.name.copy(central, 46);
      await this.write(central);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - start, 12);
    end.writeUInt32LE(start, 16);
    await this.write(end);
    if (this.offset > ZIP_MAX) throw new Error("This share is larger than 4 GB, which the archive format cannot hold");
    return this.offset;
  }

  private async write(buf: Buffer): Promise<void> {
    await this.file.write(buf, 0, buf.length, this.offset);
    this.offset += buf.length;
  }
}

function dosTime(d: Date): number {
  return (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
}

function dosDate(d: Date): number {
  return ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
}
