const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

/**
 * Check if a path should be excluded from obfuscation
 */
function shouldExclude(filePath) {
    const excludePatterns = [
        /[\\/]generated[\\/]/,     // Prisma generated files
        /[\\/]node_modules[\\/]/,  // Node modules
        /\.d\.ts$/,                // TypeScript declaration files
    ];

    return excludePatterns.some(pattern => pattern.test(filePath));
}

/**
 * Recursively obfuscate all JavaScript files in a directory
 */
function obfuscateDirectory(directory) {
    const files = fs.readdirSync(directory);

    files.forEach(file => {
        const filePath = path.join(directory, file);

        // Skip excluded paths
        if (shouldExclude(filePath)) {
            console.log(`⊘ Skipping (excluded): ${filePath}`);
            return;
        }

        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            obfuscateDirectory(filePath);
        } else if (file.endsWith('.js')) {
            obfuscateFile(filePath);
        }
    });
}

/**
 * Obfuscate a single JavaScript file
 */
function obfuscateFile(filePath) {
    try {
        console.log(`Obfuscating: ${filePath}`);
        const code = fs.readFileSync(filePath, 'utf8');

        const obfuscationResult = JavaScriptObfuscator.obfuscate(code, {
            compact: true,
            controlFlowFlattening: true,
            controlFlowFlatteningThreshold: 0.75,
            deadCodeInjection: true,
            deadCodeInjectionThreshold: 0.4,
            debugProtection: false,
            debugProtectionInterval: 0,
            disableConsoleOutput: false,
            identifierNamesGenerator: 'hexadecimal',
            log: false,
            numbersToExpressions: true,
            renameGlobals: false,
            selfDefending: true,
            simplify: true,
            splitStrings: true,
            splitStringsChunkLength: 10,
            stringArray: true,
            stringArrayCallsTransform: true,
            stringArrayCallsTransformThreshold: 0.75,
            stringArrayEncoding: ['base64'],
            stringArrayIndexShift: true,
            stringArrayRotate: true,
            stringArrayShuffle: true,
            stringArrayWrappersCount: 2,
            stringArrayWrappersChainedCalls: true,
            stringArrayWrappersParametersMaxCount: 4,
            stringArrayWrappersType: 'function',
            stringArrayThreshold: 0.75,
            transformObjectKeys: true,
            unicodeEscapeSequence: false
        });

        fs.writeFileSync(filePath, obfuscationResult.getObfuscatedCode());
        console.log(`✓ Obfuscated: ${filePath}`);
    } catch (error) {
        console.error(`✗ Failed to obfuscate ${filePath}:`, error.message);
    }
}

// Main execution
const distPath = path.join(__dirname, '..', 'dist');

if (!fs.existsSync(distPath)) {
    console.error('Error: dist directory not found. Please run "npm run build" first.');
    process.exit(1);
}

console.log('Starting obfuscation process...');
obfuscateDirectory(distPath);
console.log('Obfuscation complete!');
