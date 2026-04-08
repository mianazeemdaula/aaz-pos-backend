const fs = require('fs');
const path = require('path');

/**
 * Post-build script to prepare the exe for distribution
 * Copies necessary files to the build directory
 */

const buildDir = path.join(__dirname, '..', 'build');
const scriptsDir = path.join(__dirname);
const rootDir = path.join(__dirname, '..');

// Ensure build directory exists
if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
}

console.log('Post-build processing...');

// Copy .env.example to build directory
const envExampleSrc = path.join(rootDir, '.env.example');
const envExampleDest = path.join(buildDir, '.env.example');

if (fs.existsSync(envExampleSrc)) {
    fs.copyFileSync(envExampleSrc, envExampleDest);
    console.log('✓ Copied .env.example to build directory');
}

// Copy setup.bat to build directory
const setupBatSrc = path.join(scriptsDir, 'setup.bat');
const setupBatDest = path.join(buildDir, 'setup.bat');

if (fs.existsSync(setupBatSrc)) {
    fs.copyFileSync(setupBatSrc, setupBatDest);
    console.log('✓ Copied setup.bat to build directory');
}

// Copy fonts directory if it exists
const fontsSrc = path.join(rootDir, 'fonts');
const fontsDest = path.join(buildDir, 'fonts');

if (fs.existsSync(fontsSrc)) {
    copyDirectory(fontsSrc, fontsDest);
    console.log('✓ Copied fonts directory to build directory');
}

// Copy logo directory if it exists
const logoSrc = path.join(rootDir, 'logo');
const logoDest = path.join(buildDir, 'logo');

if (fs.existsSync(logoSrc)) {
    copyDirectory(logoSrc, logoDest);
    console.log('✓ Copied logo directory to build directory');
}

// Copy prisma migrations directory if it exists
const prismaMigrationsSrc = path.join(rootDir, 'src', 'prisma', 'migrations');
const prismaMigrationsDest = path.join(buildDir, 'prisma', 'migrations');

if (fs.existsSync(prismaMigrationsSrc)) {
    copyDirectory(prismaMigrationsSrc, prismaMigrationsDest);
    console.log('✓ Copied prisma migrations to build directory');
}

// Create README.txt for distribution
const readmeContent = `Cold Storage Application
========================================

Installation Instructions:
--------------------------
1. Run setup.bat to create your .env configuration file
2. Edit the .env file with your database credentials
3. Run cold-storage.exe --migrate --seed (first-time setup / schema + seed updates)
4. Run cold-storage.exe to start the application

Configuration:
--------------
The .env file contains:
- DATABASE_URL: PostgreSQL connection string
- PORT: Server port (default: 3000)
- JWT_SECRET: Secret key for authentication

Requirements:
-------------
- PostgreSQL database server

Support:
--------
For issues or questions, contact your system administrator.
`;

fs.writeFileSync(path.join(buildDir, 'README.txt'), readmeContent);
console.log('✓ Created README.txt in build directory');

console.log('\nPost-build processing complete!');
console.log(`Build directory: ${buildDir}`);

/**
 * Recursively copy directory
 */
function copyDirectory(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDirectory(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}
