import Scanner from './lib/scanner.js';
import DuplicateFinder from './lib/duplicates.js';
import Organizer from './lib/organizer.js';
import Cleanup from './lib/cleanup.js';
import { renderProgressBar, countFiles } from './lib/utils.js';
import { DEFAULT_OLDER_THAN } from './lib/constants.js';

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      let key, value;
      if (arg.includes('=')) {
        [key, value] = arg.slice(2).split('=');
        result[key] = value;
      } else {
        key = arg.slice(2);
        if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
          result[key] = argv[i + 1];
          i++;
        } else {
          result[key] = true;
        }
      }
    } else {
      result._.push(arg);
    }
  }
  return result;
}

const args = process.argv.slice(2);
const command = args[0];
const commandArgs = args.slice(1);

if (!command) {
  console.log(`
📁 File Organizer CLI

Commands:
  scan <directory>                    — scan and show statistics
  duplicates <directory>              — find duplicate files
  organize <source> --output <target> — organize files by category
  cleanup <directory> --older-than N  — find/delete files older than N days [--confirm]

Examples:
  node file-organizer.js scan ~/Downloads
  node file-organizer.js duplicates ~/Downloads
  node file-organizer.js organize ~/Downloads --output ~/Organized
  node file-organizer.js cleanup ~/Downloads --older-than 90
  node file-organizer.js cleanup ~/Downloads --older-than 90 --confirm
  `);
  process.exit(0);
}

async function main() {
  try {
    switch (command) {
      case 'scan': {
        const directory = commandArgs[0];
        if (!directory) throw new Error('Specify a directory to scan');
        const scanner = new Scanner();
        let processed = 0,
          totalFiles = 0;

        scanner.on('scan-start', (data) => console.log(`📂 Scanning: ${data.directory}`));
        scanner.on('file-found', () => {
          processed++;
          if (totalFiles > 0) {
            process.stdout.write(`\rProcessing... ${renderProgressBar(processed, totalFiles)}`);
          }
        });
        scanner.on('scan-complete', (data) => {
          if (totalFiles > 0) {
            process.stdout.write(
              `\rProcessing... ${renderProgressBar(data.totalFiles, data.totalFiles)}\n\n`
            );
          }
          scanner.displayResults(data);
        });
        scanner.on('file-error', (data) => {
          console.error(`\n  ⚠️ ${data.path}: ${data.error} (${data.code || 'unknown'})`);
        });
        scanner.on('dir-error', (data) => {
          console.error(`\n  ⚠️ ${data.directory}: ${data.error}`);
        });

        totalFiles = await countFiles(directory);
        await scanner.scan(directory);
        break;
      }

      case 'duplicates': {
        const directory = commandArgs[0];
        if (!directory) throw new Error('Specify a directory to scan for duplicates');
        const finder = new DuplicateFinder();
        let scanned = 0,
          totalFiles = 0;
        let hashed = 0,
          totalHashes = 0;
        let hashPhase = false;

        finder.on('scan-start', (data) =>
          console.log(`🔍 Searching for duplicates in: ${data.directory}`)
        );
        finder.on('file-processed', () => {
          scanned++;
          if (totalFiles > 0 && !hashPhase) {
            process.stdout.write(`\rScanning... ${renderProgressBar(scanned, totalFiles)}`);
          }
        });
        finder.on('hash-start', (data) => {
          hashPhase = true;
          totalHashes = data.total;
          hashed = 0;
          if (totalHashes > 0) {
            process.stdout.write(`\rHashing... ${renderProgressBar(0, totalHashes)}`);
          } else {
            process.stdout.write('\rNo files to hash (all sizes unique).      \n');
          }
        });
        finder.on('hash-progress', (data) => {
          hashed = data.processed;
          if (totalHashes > 0) {
            process.stdout.write(`\rHashing... ${renderProgressBar(hashed, totalHashes)}`);
          }
        });
        finder.on('duplicates-found', (data) => {
          if (hashPhase && totalHashes > 0) {
            process.stdout.write(`\rHashing... ${renderProgressBar(totalHashes, totalHashes)}\n\n`);
          } else if (totalFiles > 0 && !hashPhase) {
            process.stdout.write(`\rScanning... ${renderProgressBar(totalFiles, totalFiles)}\n\n`);
          }
          finder.displayResults(data);
        });
        finder.on('file-error', (data) => {
          console.error(`\n  ⚠️ ${data.path}: ${data.error} (${data.code || 'unknown'})`);
        });
        finder.on('dir-error', (data) => {
          console.error(`\n  ⚠️ ${data.directory}: ${data.error}`);
        });

        totalFiles = await countFiles(directory);
        await finder.findDuplicates(directory);
        break;
      }

      case 'organize': {
        const parsed = parseArgs(commandArgs);
        const source = parsed._[0];
        const target = parsed.output;
        if (!source) throw new Error('Specify source directory');
        if (!target) throw new Error('Specify target directory with --output');

        const organizer = new Organizer();
        let processed = 0,
          totalFiles = 0;

        organizer.on('organize-start', (data) => {
          console.log(`📦 Organizing: ${data.source}`);
          console.log(`Target: ${data.target}\nCreating folders...`);
        });
        organizer.on('folder-created', (data) => console.log(`  ✓ ${data.folder}/`));
        organizer.on('copy-complete', () => {
          processed++;
          if (totalFiles > 0) {
            process.stdout.write(`\rCopying files... ${renderProgressBar(processed, totalFiles)}`);
          }
        });
        organizer.on('copy-error', (data) => {
          console.error(`\n  ❌ ${data.source}: ${data.error} (${data.code || 'unknown'})`);
        });
        organizer.on('organize-complete', (data) => {
          if (totalFiles > 0) {
            process.stdout.write(
              `\rCopying files... ${renderProgressBar(data.totalFiles, data.totalFiles)}\n\n`
            );
          }
          organizer.displayResults(data);
        });
        organizer.on('dir-error', (data) => {
          console.error(`\n  ⚠️ ${data.directory}: ${data.error}`);
        });

        totalFiles = await countFiles(source);
        await organizer.organize(source, target);
        break;
      }

      case 'cleanup': {
        const parsed = parseArgs(commandArgs);
        const directory = parsed._[0];
        const olderThan = parseInt(parsed['older-than']) || DEFAULT_OLDER_THAN;
        const confirm = parsed.confirm === true;

        if (!directory) throw new Error('Specify a directory to clean up');
        if (olderThan <= 0) throw new Error('--older-than must be a positive number');

        const cleanup = new Cleanup();
        let processed = 0,
          totalFiles = 0;

        cleanup.on('cleanup-start', (data) => {
          console.log(`🧹 Cleanup: ${data.directory}`);
          console.log(`Looking for files older than ${data.threshold} days...\n`);
        });
        cleanup.on('file-found', () => {
          processed++;
          if (totalFiles > 0) {
            process.stdout.write(`\rScanning... ${renderProgressBar(processed, totalFiles)}`);
          }
        });
        cleanup.on('cleanup-complete', (data) => {
          if (totalFiles > 0) {
            process.stdout.write(`\rScanning... ${renderProgressBar(processed, processed)}\n\n`);
          }
          cleanup.displayResults(data, confirm);
        });
        cleanup.on('file-error', (data) => {
          console.error(`\n  ⚠️ ${data.path}: ${data.error} (${data.code || 'unknown'})`);
        });
        cleanup.on('dir-error', (data) => {
          console.error(`\n  ⚠️ ${data.directory}: ${data.error}`);
        });

        totalFiles = await countFiles(directory);
        await cleanup.cleanup(directory, olderThan, confirm);
        break;
      }

      default:
        console.error(`❌ Unknown command: "${command}"`);
        console.log('Available: scan, duplicates, organize, cleanup');
        process.exit(1);
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
