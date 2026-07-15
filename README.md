# File Organizer CLI

A Node.js command-line application for scanning directories, finding duplicate files, organizing files by category, and cleaning up old files.

## Requirements

- Node.js 18+

## Installation

```bash
git clone <repository-url>
cd file-organizer
```

## Project Structure

```text
file-organizer/
├── file-organizer.js
├── package.json
├── README.md
└── lib/
    ├── scanner.js
    ├── duplicates.js
    ├── organizer.js
    ├── cleanup.js
    ├── constants.js
    └── utils.js
```

## Commands

### Scan

```bash
node file-organizer.js scan <directory>
```

### Find duplicates

```bash
node file-organizer.js duplicates <directory>
```

### Organize files

```bash
node file-organizer.js organize <source> --output <target>
```

### Cleanup

Dry run:

```bash
node file-organizer.js cleanup <directory> --older-than 90
```

Delete files:

```bash
node file-organizer.js cleanup <directory> --older-than 90 --confirm
```

## npm Scripts

```bash
npm run scan -- ~/Downloads
npm run duplicates -- ~/Downloads
npm run organize -- ~/Downloads --output ~/Organized
npm run cleanup -- ~/Downloads --older-than 90
npm run cleanup -- ~/Downloads --older-than 90 --confirm
```

## Features

- Recursive directory scanning
- SHA-256 duplicate detection
- File organization by category
- Cleanup of old files
- Progress bars
- Stream-based processing for files ≥ 10 MB
- EventEmitter architecture
- Error handling (`ENOENT`, `EACCES`)
