# Super CD Search

An Electron desktop app for batch-querying CD information by catalog number across multiple platforms.

## Features

- **Multi-platform search**: Query CD information from Discogs, eBay, and Kojima Rokuon
- **Batch processing**: Search multiple catalog numbers at once
- **Price comparison**: Compare prices across different platforms
- **History tracking**: View previous search results
- **Export to Excel**: Export search results to .xlsx format

## Platforms Supported

| Platform | Method | Notes |
|----------|--------|-------|
| Discogs | API + Web Scraping | Requires API token for best results |
| eBay | API + Web Scraping | Requires OAuth credentials |
| Kojima Rokuon | Web Scraping | Japanese CD retailer |

## Installation

### Prerequisites

- Node.js 18+
- npm

### Development

```bash
# Install dependencies
npm install

# Rebuild native module (better-sqlite3)
npm run rebuild

# Start development server
npm run dev
```

### Build

```bash
# Build for production
npm run build

# Package as macOS app (DMG/ZIP)
npm run dist
```

## Configuration

API credentials can be configured in the Settings panel:

- **Discogs API Token**: Personal access token from Discogs
- **eBay Client ID**: OAuth client ID from eBay Developer Portal
- **eBay Client Secret**: OAuth client secret from eBay Developer Portal

Credentials are stored locally with encryption.

## Tech Stack

- **Electron** - Desktop application framework
- **React** - UI components
- **TypeScript** - Type safety
- **better-sqlite3** - Local database (SQLite)
- **Puppeteer** - Web scraping
- **ExcelJS** - Excel export

## License

ISC