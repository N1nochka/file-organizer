import fs from 'fs/promises';
import path from 'path';

export function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function renderProgressBar(current, total, width = 20) {
  if (total === 0) return '░'.repeat(width) + ' 0/0';
  const percentage = current / total;
  const filled = Math.round(percentage * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `${bar} ${(percentage * 100).toFixed(0)}% (${current}/${total})`;
}

export async function countFiles(directory) {
  let count = 0;
  const stack = [directory];
  while (stack.length) {
    const dir = stack.pop();
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.isFile()) count++;
      }
    } catch (err) {
      if (err.code !== 'EACCES' && err.code !== 'ENOENT') throw err;
    }
  }
  return count;
}

export async function walkDirectory(directory, onFile, onError = null, onDirError = null) {
  const stack = [directory];
  while (stack.length) {
    const dir = stack.pop();
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.isFile()) {
          try {
            await onFile(full, entry.name);
          } catch (err) {
            if (onError) onError(full, err);
          }
        }
      }
    } catch (err) {
      if ((err.code === 'EACCES' || err.code === 'ENOENT') && onDirError) {
        onDirError(dir, err);
      } else {
        throw err;
      }
    }
  }
}
