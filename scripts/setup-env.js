const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function setupEnvironment() {
    console.log('\n========================================');
    console.log('Cold Storage - Initial Setup');
    console.log('========================================\n');

    const exeDir = path.dirname(process.execPath);
    const envPath = path.join(exeDir, '.env');
    const envExamplePath = path.join(exeDir, '.env.example');

    // Check if .env already exists
    if (fs.existsSync(envPath)) {
        const overwrite = await question('.env file already exists. Overwrite? (y/n): ');
        if (overwrite.toLowerCase() !== 'y') {
            console.log('Setup cancelled.');
            rl.close();
            return;
        }
    }

    console.log('\nPlease provide the following configuration:\n');

    // Collect configuration
    const dbUser = await question('Database Username: ');
    const dbPass = await question('Database Password: ');
    const dbHost = await question('Database Host (default: localhost): ') || 'localhost';
    const dbPort = await question('Database Port (default: 5432): ') || '5432';
    const dbName = await question('Database Name (default: coldstorage): ') || 'coldstorage';
    const port = await question('Server Port (default: 3000): ') || '3000';
    const jwtSecret = await question('JWT Secret Key: ');

    // Build DATABASE_URL
    const databaseUrl = `postgresql://${dbUser}:${dbPass}@${dbHost}:${dbPort}/${dbName}`;

    // Create .env content
    const envContent = `# Database Configuration
DATABASE_URL=${databaseUrl}

# Server Configuration
PORT=${port}
NODE_ENV=production

# JWT Configuration
JWT_SECRET=${jwtSecret}

`;

    // Write .env file
    fs.writeFileSync(envPath, envContent);

    console.log('\n========================================');
    console.log('✓ .env file created successfully!');
    console.log('========================================');
    console.log(`\nConfiguration saved to: ${envPath}`);
    console.log('\nYou can now run the application.');
    console.log('Note: You can manually edit the .env file if needed.\n');

    rl.close();
}

setupEnvironment().catch(error => {
    console.error('Setup failed:', error);
    rl.close();
    process.exit(1);
});
