import { EventEmitter } from 'events';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { createHash } from 'crypto';
import { formatSize, walkDirectory } from './utils.js';
import { HASH_ALGORITHM, PARALLEL_HASHES } from './constants.js';

class DuplicateFinder extends EventEmitter {
  async findDuplicates(directory) {
    this.emit('scan-start', { directory });

    const filesBySize = new Map();
    await walkDirectory(
      directory,
      async (filePath, fileName) => {
        try {
          const stat = await fs.stat(filePath);
          const size = stat.size;
          if (!filesBySize.has(size)) filesBySize.set(size, []);
          filesBySize.get(size).push({ path: filePath, name: fileName, size });
          this.emit('file-processed', { path: filePath, size });
        } catch (err) {
          this.emit('file-error', { path: filePath, error: err.message, code: err.code });
        }
      },
      (filePath, err) =>
        this.emit('file-error', { path: filePath, error: err.message, code: err.code }),
      (dir, err) => {
        const msg =
          err.code === 'EACCES'
            ? 'Permission denied'
            : err.code === 'ENOENT'
              ? 'Directory not found'
              : err.message;
        this.emit('dir-error', { directory: dir, error: msg });
      }
    );

    const hashMap = new Map();
    let totalToHash = 0;
    for (const [size, files] of filesBySize) {
      if (files.length > 1) totalToHash += files.length;
    }
    this.emit('hash-start', { total: totalToHash });

    let hashed = 0;
    for (const [size, files] of filesBySize) {
      if (files.length < 2) continue;
      const batchSize = PARALLEL_HASHES;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async ({ path: filePath, size: fileSize }) => {
            try {
              const hash = await this.calculateHash(filePath);
              return { filePath, fileSize, hash, success: true };
            } catch (err) {
              this.emit('file-error', { path: filePath, error: err.message, code: err.code });
              return { filePath, fileSize, hash: null, success: false };
            }
          })
        );
        for (const res of results) {
          if (res.success) {
            const { filePath, fileSize, hash } = res;
            if (!hashMap.has(hash)) hashMap.set(hash, []);
            hashMap.get(hash).push({ path: filePath, size: fileSize });
          }
          hashed++;
          this.emit('hash-progress', { processed: hashed, total: totalToHash });
        }
      }
    }

    const duplicateGroups = [];
    let totalWasted = 0;
    for (const [hash, files] of hashMap) {
      if (files.length > 1) {
        const fileSize = files[0].size;
        const wasted = fileSize * (files.length - 1);
        totalWasted += wasted;
        duplicateGroups.push({ hash, paths: files.map((f) => f.path), size: fileSize, wasted });
      }
    }
    duplicateGroups.sort((a, b) => b.wasted - a.wasted);

    this.emit('duplicates-found', {
      duplicateGroups,
      totalWasted,
      totalWastedFormatted: formatSize(totalWasted),
    });
  }

  calculateHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = createHash(HASH_ALGORITHM);
      const stream = createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  displayResults(data) {
    const { duplicateGroups, totalWastedFormatted } = data;
    if (duplicateGroups.length === 0) {
      console.log('✅ No duplicates found!');
      return;
    }

    console.log(
      `Found ${duplicateGroups.length} duplicate groups (${totalWastedFormatted} wasted):\n`
    );
    duplicateGroups.forEach((group, idx) => {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(
        `Group ${idx + 1} (${group.paths.length} copies, ${formatSize(group.size)} each):`
      );
      console.log(`  SHA-256: ${group.hash.slice(0, 12)}...\n`);
      group.paths.forEach((p) => console.log(`  📄 ${p}`));
      console.log(`\n  Wasted space: ${formatSize(group.wasted)}\n`);
    });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`💾 Total wasted space: ${totalWastedFormatted}\n`);
  }
}

export default DuplicateFinder;
