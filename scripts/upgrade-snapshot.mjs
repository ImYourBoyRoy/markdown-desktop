import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, realpathSync } from 'node:fs';
import { dirname, join, isAbsolute, sep, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export function writeJson(file, value) {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2));
  renameSync(temporary, file);
}

function localFile(root, relative) {
  if (isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Unsafe snapshot path');
  const canonicalRoot = realpathSync(root);
  const file = resolve(root, relative);
  let ancestor = file;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const canonical = realpathSync(ancestor);
  if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${sep}`)) throw new Error('Snapshot path escapes through a symlink');
  return file;
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function captureSnapshot(root, directory, files) {
  const inventory = files.map((path) => {
    const source = localFile(root, path);
    if (!existsSync(source)) return { path, existed: false };
    const bytes = readFileSync(source);
    const destination = localFile(directory, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
    return { path, existed: true, sha256: hash(bytes) };
  });
  writeJson(join(directory, 'files.json'), inventory);
}

export function restoreSnapshot(root, directory, allowedFiles) {
  const inventory = JSON.parse(readFileSync(join(directory, 'files.json'), 'utf8'));
  if (!Array.isArray(inventory) || inventory.length !== allowedFiles.length
    || new Set(inventory.map((entry) => entry.path)).size !== inventory.length) throw new Error('Invalid snapshot inventory');
  // Validate every file before writing any target, including snapshot integrity.
  const prepared = inventory.map((entry) => {
    if (!allowedFiles.includes(entry.path) || typeof entry.existed !== 'boolean') throw new Error('Unexpected snapshot target');
    const target = localFile(root, entry.path);
    const bytes = entry.existed ? readFileSync(localFile(directory, entry.path)) : null;
    if (bytes && hash(bytes) !== entry.sha256) throw new Error('Snapshot integrity check failed');
    return { target, bytes };
  });
  for (const { target, bytes } of prepared) {
    if (bytes !== null) {
      mkdirSync(dirname(target), { recursive: true });
      const temporary = `${target}.upgrade-restore.tmp`;
      writeFileSync(temporary, bytes);
      renameSync(temporary, target);
    } else if (existsSync(target)) unlinkSync(target);
  }
}
