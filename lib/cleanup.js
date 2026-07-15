import { EventEmitter } from 'events';
import fs from 'fs/promises';
import { formatSize, walkDirectory } from './utils.js';

class Cleanup extends EventEmitter {
  async cleanup(directory, olderThanDays, confirm = false) {
    this.emit('cleanup-start', { directory, threshold: olderThanDays });
    const filesToDelete = [];

    const now = Date.now();
    const thresholdMs = olderThanDays * 24 * 60 * 60 * 1000;

    await walkDirectory(
      directory,
      async (filePath, fileName) => {
        try {
          const stat = await fs.stat(filePath);
          const age = now - stat.mtime.getTime();
          if (age > thresholdMs) {
            const daysOld = Math.round(age / (1000 * 60 * 60 * 24));
            filesToDelete.push({
              path: filePath,
              name: fileName,
              size: stat.size,
              mtime: stat.mtime,
              daysOld,
            });
            this.emit('file-found', { path: filePath, name: fileName, daysOld });
          }
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

    filesToDelete.sort((a, b) => b.daysOld - a.daysOld);
    const totalSize = filesToDelete.reduce((sum, f) => sum + f.size, 0);

    if (!confirm) {
      this.emit('cleanup-complete', {
        files: filesToDelete,
        totalFiles: filesToDelete.length,
        totalSize,
        totalSizeFormatted: formatSize(totalSize),
        deleted: false,
        dryRun: true,
      });
      return;
    }

    let deletedCount = 0,
      deletedSize = 0;
    for (const file of filesToDelete) {
      try {
        await fs.unlink(file.path);
        deletedCount++;
        deletedSize += file.size;
        this.emit('file-deleted', { path: file.path, name: file.name });
      } catch (err) {
        this.emit('file-error', { path: file.path, error: err.message, code: err.code });
      }
    }

    this.emit('cleanup-complete', {
      files: filesToDelete,
      totalFiles: filesToDelete.length,
      totalSize,
      totalSizeFormatted: formatSize(totalSize),
      deleted: true,
      deletedCount,
      deletedSize,
      deletedSizeFormatted: formatSize(deletedSize),
      dryRun: false,
    });
  }

  displayResults(data) {
    const { files, totalFiles, totalSizeFormatted, dryRun } = data;

    if (totalFiles === 0) {
      console.log('✅ No files to delete.');
      return;
    }

    console.log(`Found ${totalFiles} files to delete:\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const showCount = Math.min(10, files.length);
    for (let i = 0; i < showCount; i++) {
      const f = files[i];
      const dateStr = f.mtime.toISOString().slice(0, 10);
      console.log(`${f.name}`);
      console.log(`  Size: ${formatSize(f.size)}`);
      console.log(`  Modified: ${f.daysOld} days ago (${dateStr})\n`);
    }
    if (files.length > 10) {
      console.log(`... (${files.length - 10} more files)\n`);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total: ${totalFiles} files (${totalSizeFormatted})`);

    if (dryRun) {
      console.log('\n⚠️  DRY RUN MODE: No files were deleted.');
      console.log('To actually delete these files, run with --confirm flag.\n');
    } else {
      console.log(`\n✅ Cleanup complete!`);
      console.log(`Deleted: ${data.deletedCount} files (${data.deletedSizeFormatted} freed)\n`);
    }
  }
}

export default Cleanup;
