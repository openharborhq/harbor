import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, describe } from "node:test";
import { Readable } from "node:stream";
import { BUNDLE_HEADER_BYTES, StoredZipWriter, crc32, openBundleStream, sealBundle, sealedLength } from "./index";

async function scratch(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "harbor-bundle-"));
}

async function collect(stream: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

/** Read a bundle back the way the doorman does: by offset, out of a file. */
function readerFor(handle: Awaited<ReturnType<typeof open>>) {
  return async (offset: number, length: number) => {
    const buf = Buffer.alloc(length);
    await handle.read(buf, 0, length, offset);
    return buf;
  };
}

describe("crc32", () => {
  test("matches the standard check value", () => {
    assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  });

  test("is the same seeded across chunks as computed in one go", () => {
    const data = randomBytes(5000);
    const whole = crc32(data);
    let seeded = 0;
    for (let i = 0; i < data.length; i += 512) seeded = crc32(data.subarray(i, i + 512), seeded);
    assert.equal(seeded, whole);
  });
});

describe("StoredZipWriter", () => {
  test("writes an archive whose entries read back byte for byte", async () => {
    const dir = await scratch();
    try {
      const file = path.join(dir, "b.zip");
      const handle = await open(file, "w+");
      const zip = new StoredZipWriter(handle, new Date("2026-09-14T10:00:00Z"));
      const passport = randomBytes(3000);
      const bill = Buffer.from("Rechnung über 248,10 €", "utf8");
      await zip.addFile("Reisepass.pdf", Readable.from([passport]));
      await zip.addFile("Rechnung.pdf", Readable.from([bill]));
      const total = await zip.finish();
      await handle.close();

      const raw = Buffer.alloc(total);
      const rh = await open(file, "r");
      await rh.read(raw, 0, total, 0);
      await rh.close();

      const entries = parseZip(raw);
      assert.deepEqual(
        entries.map((e) => e.name),
        ["Reisepass.pdf", "Rechnung.pdf"],
      );
      assert.deepEqual(entries[0].data, passport);
      assert.deepEqual(entries[1].data, bill);
      // Stored, not deflated — the whole point of the format choice.
      assert.equal(entries[0].method, 0);
      // The CRC in the central directory is the real one, not the placeholder.
      assert.equal(entries[0].crc, crc32(passport));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("names survive as UTF-8", async () => {
    const dir = await scratch();
    try {
      const file = path.join(dir, "u.zip");
      const handle = await open(file, "w+");
      const zip = new StoredZipWriter(handle, new Date());
      await zip.addFile("Grundsteuerbescheid – 2025.pdf", Readable.from([Buffer.from("x")]));
      const total = await zip.finish();
      await handle.close();
      const raw = Buffer.alloc(total);
      const rh = await open(file, "r");
      await rh.read(raw, 0, total, 0);
      await rh.close();
      assert.equal(parseZip(raw)[0].name, "Grundsteuerbescheid – 2025.pdf");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("sealBundle", () => {
  const key = randomBytes(32);

  test("round-trips across chunk boundaries and pads to the declared size", async () => {
    const dir = await scratch();
    try {
      const plain = randomBytes(1000);
      const file = path.join(dir, "bundle");
      const handle = await open(file, "w+");
      const padTo = 4096;
      const { sealedBytes, paddedBytes } = await sealBundle({
        source: Readable.from([plain.subarray(0, 300), plain.subarray(300)]),
        plaintextLength: plain.length,
        dest: handle,
        key,
        padTo,
        chunkSize: 64,
      });
      await handle.close();

      assert.equal(sealedBytes, sealedLength(plain.length, 64));
      assert.equal(paddedBytes, padTo);
      // The size on disk is the padded one. That is the only size anyone else sees.
      assert.equal((await stat(file)).size, padTo);

      const rh = await open(file, "r");
      const out = await collect(openBundleStream(key, readerFor(rh)));
      await rh.close();
      assert.deepEqual(out, plain);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an empty bundle still reads back as empty", async () => {
    const dir = await scratch();
    try {
      const file = path.join(dir, "empty");
      const handle = await open(file, "w+");
      await sealBundle({ source: Readable.from([]), plaintextLength: 0, dest: handle, key, padTo: 1024, chunkSize: 64 });
      await handle.close();
      const rh = await open(file, "r");
      const out = await collect(openBundleStream(key, readerFor(rh)));
      await rh.close();
      assert.equal(out.length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a flipped byte in the ciphertext fails to open", async () => {
    const dir = await scratch();
    try {
      const plain = randomBytes(200);
      const file = path.join(dir, "tampered");
      const handle = await open(file, "w+");
      await sealBundle({ source: Readable.from([plain]), plaintextLength: plain.length, dest: handle, key, padTo: 2048, chunkSize: 64 });
      const flip = Buffer.from([0xff]);
      await handle.write(flip, 0, 1, BUNDLE_HEADER_BYTES + 40);
      await handle.close();

      const rh = await open(file, "r");
      await assert.rejects(() => collect(openBundleStream(key, readerFor(rh))));
      await rh.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a chunk moved to another position fails to open", async () => {
    const dir = await scratch();
    try {
      const plain = randomBytes(192); // exactly three 64-byte chunks
      const file = path.join(dir, "reordered");
      const handle = await open(file, "w+");
      await sealBundle({ source: Readable.from([plain]), plaintextLength: plain.length, dest: handle, key, padTo: 2048, chunkSize: 64 });

      // Swap chunk 0 and chunk 1. Each is iv(12) + tag(16) + 64 bytes of ciphertext.
      const width = 12 + 16 + 64;
      const first = Buffer.alloc(width);
      const second = Buffer.alloc(width);
      await handle.read(first, 0, width, BUNDLE_HEADER_BYTES);
      await handle.read(second, 0, width, BUNDLE_HEADER_BYTES + width);
      await handle.write(second, 0, width, BUNDLE_HEADER_BYTES);
      await handle.write(first, 0, width, BUNDLE_HEADER_BYTES + width);
      await handle.close();

      const rh = await open(file, "r");
      await assert.rejects(() => collect(openBundleStream(key, readerFor(rh))));
      await rh.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("another share's key cannot open it", async () => {
    const dir = await scratch();
    try {
      const plain = randomBytes(100);
      const file = path.join(dir, "wrong-key");
      const handle = await open(file, "w+");
      await sealBundle({ source: Readable.from([plain]), plaintextLength: plain.length, dest: handle, key, padTo: 1024, chunkSize: 64 });
      await handle.close();
      const rh = await open(file, "r");
      await assert.rejects(() => collect(openBundleStream(randomBytes(32), readerFor(rh))));
      await rh.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/** Minimal reader, enough to prove the writer produced a real archive. */
function parseZip(raw: Buffer): { name: string; method: number; crc: number; data: Buffer }[] {
  const eocd = raw.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0, "no end-of-central-directory record");
  const count = raw.readUInt16LE(eocd + 10);
  let at = raw.readUInt32LE(eocd + 16);
  const out: { name: string; method: number; crc: number; data: Buffer }[] = [];
  for (let i = 0; i < count; i++) {
    assert.equal(raw.readUInt32LE(at), 0x02014b50);
    const method = raw.readUInt16LE(at + 10);
    const crc = raw.readUInt32LE(at + 16);
    const size = raw.readUInt32LE(at + 24);
    const nameLen = raw.readUInt16LE(at + 28);
    const localOffset = raw.readUInt32LE(at + 42);
    const name = raw.subarray(at + 46, at + 46 + nameLen).toString("utf8");

    assert.equal(raw.readUInt32LE(localOffset), 0x04034b50);
    const localNameLen = raw.readUInt16LE(localOffset + 26);
    const extraLen = raw.readUInt16LE(localOffset + 28);
    const dataAt = localOffset + 30 + localNameLen + extraLen;
    const data = raw.subarray(dataAt, dataAt + size);
    assert.equal(crc32(data), crc, `crc mismatch for ${name}`);
    out.push({ name, method, crc, data });
    at += 46 + nameLen + raw.readUInt16LE(at + 30) + raw.readUInt16LE(at + 32);
  }
  return out;
}
