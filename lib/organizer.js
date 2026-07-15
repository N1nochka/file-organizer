import { EventEmitter } from 'events';
import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';
import { formatSize, walkDirectory } from './utils.js';
import { LARGE_FILE_SIZE } from './constants.js';

const CATEGORIES = {
  Documents: ['.pdf', '.docx', '.doc', '.txt', '.md', '.xlsx', '.pptx', '.odt', '.rtf'],
  Images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico'],
  Archives: ['.zip', '.rar', '.tar', '.gz', '.7z', '.bz2'],
  Code: ['.js', '.py', '.java', '.cpp', '.c', '.html', '.css', '.json', '.xml', '.sh'],
  Videos: ['.mp4', '.avi', '.mkv', '.mov', '.webm', '.flv', '.wmv'],
};

const CATEGORY_NAMES = Object.keys(CATEGORIES);
const OTHER = 'Other';

class Organizer extends EventEmitter {
  constructor() {
    super();
    this.stats = {
      totalFiles: 0,
      totalSize: 0,
      byCategory: {},
    };
    for (const cat of [...CATEGORY_NAMES, OTHER]) {
      this.stats.byCategory[cat] = { count: 0, totalSize: 0 };
    }
  }

  getCategory(ext) {
    ext = ext.toLowerCase();
    for (const [cat, exts] of Object.entries(CATEGORIES)) {
      if (exts.includes(ext)) return cat;
    }
    return OTHER;
  }

  async getUniqueFilePath(targetDir, baseName) {
    const { name, ext } = path.parse(baseName);
    let counter = 0;
    let candidate = path.join(targetDir, baseName);
    while (true) {
      try {
        await fs.access(candidate);
        counter++;
        candidate = path.join(targetDir, `${name}(${counter})${ext}`);
      } catch {
        return candidate;
      }
    }
  }

  async copyFile(source, target, size) {
    if (size >= LARGE_FILE_SIZE) {
      await pipeline(createReadStream(source), createWriteStream(target));
    } else {
      await fs.copyFile(source, target);
    }
  }

  async organize(sourceDir, targetDir) {
    this.emit('organize-start', { source: sourceDir, target: targetDir });

    await fs.mkdir(targetDir, { recursive: true });

    const sourceReal = await fs.realpath(sourceDir);
    const targetReal = await fs.realpath(targetDir);
    if (sourceReal === targetReal) {
      throw new Error('Source and target directories must be different');
    }

    for (const cat of [...CATEGORY_NAMES, OTHER]) {
      this.stats.byCategory[cat] = { count: 0, totalSize: 0 };
    }
    this.stats.totalFiles = 0;
    this.stats.totalSize = 0;

    const allCats = [...CATEGORY_NAMES, OTHER];
    for (const cat of allCats) {
      const folderPath = path.join(targetDir, cat);
      await fs.mkdir(folderPath, { recursive: true });
      this.emit('folder-created', { folder: cat });
    }

    await walkDirectory(
      sourceDir,
      async (filePath, fileName) => {
        const relative = path.relative(targetDir, filePath);
        if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
          return;
        }
        try {
          const stat = await fs.stat(filePath);
          const size = stat.size;
          const ext = path.extname(fileName);
          const category = this.getCategory(ext);
          const categoryDir = path.join(targetDir, category);
          const targetPath = await this.getUniqueFilePath(categoryDir, fileName);

          await this.copyFile(filePath, targetPath, size);

          this.stats.totalFiles++;
          this.stats.totalSize += size;
          this.stats.byCategory[category].count++;
          this.stats.byCategory[category].totalSize += size;

          this.emit('copy-complete', { source: filePath, target: targetPath, size });
        } catch (err) {
          this.emit('copy-error', { source: filePath, error: err.message, code: err.code });
        }
      },
      (filePath, err) =>
        this.emit('copy-error', { source: filePath, error: err.message, code: err.code }),
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

    this.emit('organize-complete', {
      ...this.stats,
      totalSizeFormatted: formatSize(this.stats.totalSize),
      targetDir,
    });
  }

  displayResults(data) {
    console.log('✅ Organization complete!\n');
    console.log('Summary:');
    for (const [cat, info] of Object.entries(data.byCategory)) {
      if (info.count > 0) {
        const sizeStr = formatSize(info.totalSize);
        console.log(
          `  ${cat.padEnd(12)} ${info.count.toString().padStart(4)} files → ${data.targetDir}/${cat}/`
        );
      }
    }
    console.log(`\nTotal copied: ${data.totalFiles} files (${data.totalSizeFormatted})`);
    console.log('');
  }
}

export default Organizer;
