"use strict";

const endSignature = 0x06054b50;
const directorySignature = 0x02014b50;
const fileSignature = 0x04034b50;
const maxGlyphBytes = 16 * 1024 * 1024;
const imageName = /\.(png|webp|jpe?g)$/i;

const archiveDirectories = new Map();

function bytesAt(archive, start, end) {
  return archive instanceof Blob ? archive.slice(start, end) : archive.read(start, end);
}

async function dataView(archive, start, end) {
  const bytes = await bytesAt(archive, start, end);
  return new DataView(await bytes.arrayBuffer());
}

async function readRange(url, range) {
  const response = await fetch(url, {
    headers: { Range: range },
    credentials: "omit",
    signal: AbortSignal.timeout(12000),
  });
  if (response.status !== 206) {
    await response.body?.cancel();
    throw new Error("Archive range unavailable");
  }
  return response;
}

async function openRemoteArchive(mapset) {
  const url = "https://osu.direct/api/d/" + mapset;
  const response = await readRange(url, "bytes=-65557");
  const size = Number(response.headers.get("Content-Range")?.split("/").pop());
  const tail = await response.blob();
  if (!Number.isSafeInteger(size) || tail.size < 22 || size < tail.size) {
    throw new Error("Archive unavailable");
  }
  const tailStart = size - tail.size;
  const archive = {
    size,
    async read(start, end) {
      if (start >= tailStart) return tail.slice(start - tailStart, end - tailStart);
      const response = await readRange(url, `bytes=${start}-${end - 1}`);
      const bytes = await response.blob();
      if (bytes.size !== end - start) throw new Error("Invalid archive range");
      return bytes;
    },
  };
  return { archive, entries: await archiveEntries(archive) };
}

async function loadRemoteCover(recipe) {
  const id = recipe.mapset;
  if (!archiveDirectories.has(id)) {
    const pending = openRemoteArchive(id);
    archiveDirectories.set(id, pending);
    pending.catch(() => archiveDirectories.delete(id));
  }
  const { archive, entries } = await archiveDirectories.get(id);
  const entry = entries.find((item) => item.name === recipe.file && item.crc === (recipe.mirrorCrc ?? recipe.crc));
  if (!entry) throw new Error("Cover unavailable");
  const image = await readLocalImage(await readEntry(archive, entry));
  if (!recipe.crop) return image;
  return readLocalImage(await encodeGlyph(clipGlyph(image, recipe)));
}

async function archiveEntries(blob) {
  const start = Math.max(0, blob.size - 65557);
  const tail = await dataView(blob, start, blob.size);
  let end = tail.byteLength - 22;
  for (; end >= 0; end--) {
    if (tail.getUint32(end, true) === endSignature &&
        tail.getUint16(end + 20, true) === tail.byteLength - end - 22) break;
  }
  if (end < 0 || tail.getUint32(end + 4, true)) throw new Error("Unsupported ZIP");
  const count = tail.getUint16(end + 10, true);
  const size = tail.getUint32(end + 12, true);
  const offset = tail.getUint32(end + 16, true);
  if (size > 8 * 1024 * 1024 || offset + size > start + end || count === 65535) {
    throw new Error("Invalid ZIP directory");
  }
  const directory = await dataView(blob, offset, offset + size);
  const entries = [];
  const decoder = new TextDecoder();
  let position = 0;
  for (let i = 0; i < count; i++) {
    if (position + 46 > size || directory.getUint32(position, true) !== directorySignature) {
      throw new Error("Invalid ZIP entry");
    }
    const nameSize = directory.getUint16(position + 28, true);
    const extraSize = directory.getUint16(position + 30, true);
    const commentSize = directory.getUint16(position + 32, true);
    if (position + 46 + nameSize + extraSize + commentSize > size) throw new Error("Invalid ZIP filename");
    const name = decoder.decode(new Uint8Array(directory.buffer, position + 46, nameSize)).split(/[\\/]/).pop();
    if (imageName.test(name)) {
      entries.push({
        name,
        flags: directory.getUint16(position + 8, true),
        method: directory.getUint16(position + 10, true),
        crc: directory.getUint32(position + 16, true).toString(16).padStart(8, "0"),
        packedSize: directory.getUint32(position + 20, true),
        size: directory.getUint32(position + 24, true),
        offset: directory.getUint32(position + 42, true),
      });
    }
    position += 46 + nameSize + extraSize + commentSize;
  }
  return entries;
}

async function readEntry(archive, entry) {
  if (!entry.size || entry.size > maxGlyphBytes || entry.packedSize > maxGlyphBytes || entry.flags & 1) {
    throw new Error("Unsupported ZIP image");
  }
  const header = await dataView(archive, entry.offset, entry.offset + 30);
  if (header.byteLength !== 30 || header.getUint32(0, true) !== fileSignature) throw new Error("Invalid ZIP image");
  const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const stop = start + entry.packedSize;
  if (stop > archive.size) throw new Error("Truncated ZIP");
  const bytes = await bytesAt(archive, start, stop);
  if (entry.method === 0 && entry.size === entry.packedSize) return bytes;
  if (entry.method !== 8) throw new Error("Unsupported ZIP compression");

  const reader = bytes.stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const parts = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > entry.size) {
      await reader.cancel();
      throw new Error("Invalid ZIP image size");
    }
    parts.push(value);
  }
  if (total !== entry.size) throw new Error("Truncated ZIP image");
  return new Blob(parts);
}

function clipGlyph(image, recipe) {
  if (image.naturalWidth !== recipe.width || image.naturalHeight !== recipe.height) {
    throw new Error("Unexpected cover dimensions");
  }
  const [x, y, width, height] = recipe.crop;
  const [offsetX, offsetY] = recipe.pathOffset;
  const context = layer(width, height);
  context.translate(-offsetX, -offsetY);
  context.clip(new Path2D(recipe.path), "evenodd");
  context.resetTransform();
  context.drawImage(image, -x, -y);
  return context.canvas;
}

function encodeGlyph(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Cannot encode glyph")), "image/png");
  });
}

async function importGlyphArchive(archive) {
  const directory = await archiveEntries(archive);
  const bySignature = new Map(directory.map((entry) => [entry.name.toLowerCase() + ":" + entry.crc, entry]));
  const jobs = coverRecipes.flatMap((recipe) => {
    const prefix = recipe.file.toLowerCase() + ":";
    const entry = bySignature.get(prefix + recipe.crc) ?? bySignature.get(prefix + recipe.mirrorCrc);
    if (!entry) return [];
    return [(async () => {
      const image = await readEntry(archive, entry);
      const blob = recipe.crop ? await encodeGlyph(clipGlyph(await readLocalImage(image), recipe)) : image;
      return { key: recipe.key, label: recipe.label, blob };
    })()];
  });
  if (!jobs.length) throw new Error("No recognized glyphs");
  return Promise.all(jobs);
}

function glyphDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("cover-letter-library", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("glyphs", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readGlyphRecords() {
  const database = await glyphDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction("glyphs").objectStore("glyphs").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function saveGlyphRecords(records) {
  const database = await glyphDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("glyphs", "readwrite");
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
      const store = transaction.objectStore("glyphs");
      for (const record of records) store.put(record);
    });
  } finally {
    database.close();
  }
}
