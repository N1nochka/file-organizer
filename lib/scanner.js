import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { formatSize, walkDirectory } from './utils.js';
import { MAX_TOP_FILES } from './constants.js';

class Scanner extends EventEmitter {
  async scan(directory) {
    this.emit('scan-start', { directory });

    const stats = {
      totalFiles: 0,
      totalSize: 0,
      byType: new Map(),
      byAge: { last7days: 0, last30days: 0, olderThan90: 0 },
      largestFiles: [],
      oldestFile: null,
      oldestAge: 0,
    };

    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;

    const addToLargest = (filePath, fileName, size) => {
      const arr = stats.largestFiles;
      let pos = arr.length;
      for (let i = 0; i < arr.length; i++) {
        if (size > arr[i].size) {
          pos = i;
          break;
        }
      }
      if (pos < MAX_TOP_FILES) {
        arr.splice(pos, 0, { path: filePath, name: fileName, size });
        if (arr.length > MAX_TOP_FILES) arr.pop();
      }
    };

    await walkDirectory(
      directory,
      async (filePath, fileName) => {
        try {
          const stat = await fs.stat(filePath);
          const size = stat.size;
          const age = now - stat.mtime.getTime();

          stats.totalFiles++;
          stats.totalSize += size;

          const ext = path.extname(fileName).toLowerCase() || '(no extension)';
          if (!stats.byType.has(ext)) {
            stats.byType.set(ext, { count: 0, totalSize: 0 });
          }
          const typeData = stats.byType.get(ext);
          typeData.count++;
          typeData.totalSize += size;

          if (age <= sevenDays) stats.byAge.last7days++;
          else if (age <= thirtyDays) stats.byAge.last30days++;
          else if (age > ninetyDays) stats.byAge.olderThan90++;

          addToLargest(filePath, fileName, size);

          if (age > stats.oldestAge) {
            stats.oldestAge = age;
            stats.oldestFile = { path: filePath, name: fileName, mtime: stat.mtime };
          }

          this.emit('file-found', { path: filePath, name: fileName, size });
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

    const largestDisplay = stats.largestFiles.map((f, i) => ({
      rank: i + 1,
      name: f.name,
      size: f.size,
      sizeFormatted: formatSize(f.size),
    }));

    let oldestDays = 0;
    if (stats.oldestFile) {
      oldestDays = Math.round(stats.oldestAge / (1000 * 60 * 60 * 24));
    }

    this.emit('scan-complete', {
      ...stats,
      byType: stats.byType,
      largestFiles: largestDisplay,
      oldestFile: stats.oldestFile
        ? { name: stats.oldestFile.name, days: oldestDays, mtime: stats.oldestFile.mtime }
        : null,
      totalSizeFormatted: formatSize(stats.totalSize),
    });
  }

  displayResults(data) {
    console.log('📊 Scan Results:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total files: ${data.totalFiles}`);
    console.log(`Total size: ${data.totalSizeFormatted}\n`);

    console.log('By File Type:');
    const sortedTypes = Array.from(data.byType.entries()).sort(
      (a, b) => b[1].totalSize - a[1].totalSize
    );

    let otherCount = 0,
      otherSize = 0;
    const topTypes = sortedTypes.slice(0, 5);
    for (const [ext, info] of topTypes) {
      const sizeStr = formatSize(info.totalSize).padStart(8);
      console.log(`  ${ext.padEnd(10)} ${info.count.toString().padStart(4)} files   ${sizeStr}`);
    }
    if (sortedTypes.length > 5) {
      for (const [, info] of sortedTypes.slice(5)) {
        otherCount += info.count;
        otherSize += info.totalSize;
      }
      const sizeStr = formatSize(otherSize).padStart(8);
      console.log(`  (other)  ${otherCount.toString().padStart(4)} files   ${sizeStr}`);
    }

    console.log('\nFile Age:');
    console.log(`  Last 7 days:    ${data.byAge.last7days} files`);
    console.log(`  Last 30 days:   ${data.byAge.last30days} files`);
    console.log(`  Older than 90:  ${data.byAge.olderThan90} files`);

    console.log('\nLargest files:');
    data.largestFiles.forEach((f) => {
      console.log(`  ${f.rank}. ${f.name.padEnd(25)} ${f.sizeFormatted}`);
    });

    if (data.oldestFile) {
      console.log(
        `\nOldest file: ${data.oldestFile.name} (modified ${data.oldestFile.days} days ago)`
      );
    }
    console.log('');
  }
}

export default Scanner;
