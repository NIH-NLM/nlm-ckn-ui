const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Defines remote repository and local file paths.
const GITHUB_REPO_URL = 'https://raw.githubusercontent.com/NIH-NLM/cell-kn-mvp-etl-ontologies';
const REMOTE_FILE_PATH = 'data/cell-kn-mvp-collection-maps.json';
const SOURCE_CONFIG_PATH = path.resolve(__dirname, '../collections-data-source.json');
const OUTPUT_PATH = path.resolve(__dirname, `../src/assets/${REMOTE_FILE_PATH.split('/').pop()}`);

/**
 * Syncs collection map data from a versioned remote source.
 * Exits early if local version matches target version.
 * Halts build process on any failure.
 */
async function fetchCollectionsMap() {
  try {
    // Read target version from config file.
    const sourceConfig = JSON.parse(fs.readFileSync(SOURCE_CONFIG_PATH, 'utf-8'));
    const targetVersion = sourceConfig.version;
    console.log(`[Sync Data] Required version: ${targetVersion}`);

    // Check currently downloaded file for its embedded version.
    let localVersion = null;
    if (fs.existsSync(OUTPUT_PATH)) {
      const localData = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
      localVersion = localData._sourceVersion; // Read internal version key.
    }

    // Exit successfully if local version already matches target.
    if (localVersion === targetVersion) {
      console.log(`[Sync Data] Local version (${localVersion}) matches. Sync complete.`);
      return;
    }

    console.log(`[Sync Data] Local version is '${localVersion || 'missing'}'. Fetching target '${targetVersion}'...`);

    // Fetch data from URL constructed with specific version tag and full file path.
    const fileUrl = `${GITHUB_REPO_URL}/${targetVersion}/${REMOTE_FILE_PATH}`;
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} for URL ${fileUrl}`);
    }
    const data = await response.json();

    // Inject version into data for future comparison checks.
    const dataWithVersion = {
      _sourceVersion: targetVersion,
      data: data
    };

    // Write updated data to destination, ensuring directory exists.
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(dataWithVersion, null, 2), 'utf-8');

    console.log(`[Sync Data] Successfully saved version ${targetVersion} to ${OUTPUT_PATH}`);

  } catch (error) {
    console.error(`[Sync Data] CRITICAL ERROR: ${error.message}`);
    // Exit with non-zero code to halt calling process.
    process.exit(1);
  }
}

// Execute sync process.
fetchCollectionsMap();