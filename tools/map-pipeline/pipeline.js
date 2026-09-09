const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Configuration
// Locate Blender: prefer the `blender` on PATH, then common install locations.
const COMMON_BLENDER_PATHS = [
    'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe',
    'C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe',
    'C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe',
    'C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe',
    'C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe',
    'C:\\Program Files\\Blender Foundation\\Blender 4.1\\blender.exe',
    'C:\\Program Files\\Blender Foundation\\Blender 4.0\\blender.exe',
    'C:\\Program Files\\Blender Foundation\\Blender 3.6\\blender.exe',
    '/usr/bin/blender',
    '/usr/local/bin/blender',
];
function findBlender() {
    try {
        const { execSync } = require('child_process');
        const found = execSync(process.platform === 'win32' ? 'where blender' : 'which blender', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split(/\r?\n/)[0];
        if (found) return found;
    } catch (e) { /* not on PATH */ }
    for (const p of COMMON_BLENDER_PATHS) {
        if (fs.existsSync(p)) return p;
    }
    return 'blender';
}

// Project root is two levels up from this script: tools/map-pipeline/ → gamerwheels/
const PROJECT_ROOT = path.join(__dirname, '..', '..');

const CONFIG = {
    blenderExecutable: findBlender(),
    scriptPath: path.join(__dirname, 'convert_thps.py'),
    inputDir: path.join(PROJECT_ROOT, 'maps-in'),
    outputDir: path.join(PROJECT_ROOT, 'public', 'assets', 'maps'),
    addonDir: path.join(PROJECT_ROOT, 'Blender-Addons', 'io_thps_scene'),
    supportedExtensions: ['.prk', '.PRK'],
};

async function convertMap(inputFile, outputFile) {
    const inputPath = path.join(CONFIG.inputDir, inputFile);
    const outputPath = outputFile
        ? path.join(CONFIG.outputDir, outputFile)
        : path.join(CONFIG.outputDir, path.parse(inputFile).name + '.glb');

    // Ensure output directory exists
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });

    // Verify input exists
    if (!fs.existsSync(inputPath)) {
        throw new Error(`Input file not found: ${inputPath}`);
    }

    // Verify Blender script exists
    if (!fs.existsSync(CONFIG.scriptPath)) {
        throw new Error(`Blender script not found: ${CONFIG.scriptPath}`);
    }

    // Build command
    // Note: Blender requires -b for background, -P for python script
    // Arguments after -- are passed to sys.argv in the script
    // First arg = addon dir (for compat transforms), then input, then output.
    // Quote every argument so paths containing spaces (e.g. Program Files) work.
    const quote = (v) => `"${String(v).replace(/"/g, '\\"')}"`;
    const command = [
        quote(CONFIG.blenderExecutable),
        '-b',
        '-P', quote(CONFIG.scriptPath),
        '--',
        quote(CONFIG.addonDir),
        quote(inputPath),
        quote(outputPath),
    ].join(' ');

    console.log(`\n🔄 Converting: ${inputFile} → ${path.basename(outputPath)}`);
    console.log(`   Command: ${command}\n`);

    try {
        const { stdout, stderr } = await execAsync(command, {
            timeout: 300000,  // 5 minute timeout for large maps
            maxBuffer: 1024 * 1024 * 20  // 20MB buffer
        });

        if (stdout) console.log(stdout);
        if (stderr && !stderr.includes('Warning:') && !stderr.includes('LiDAR')) {
            console.warn(`⚠ Stderr: ${stderr}`);
        }

        // Verify output
        if (fs.existsSync(outputPath)) {
            const stats = fs.statSync(outputPath);
            console.log(`✅ Success! ${path.basename(outputPath)} (${(stats.size / 1024).toFixed(1)} KB)`);
            return { success: true, outputPath, size: stats.size };
        } else {
            throw new Error('Output file was not created');
        }

    } catch (error) {
        console.error(`❌ Conversion failed: ${error.message}`);
        if (error.stdout) console.log(`Stdout: ${error.stdout}`);
        if (error.stderr) console.error(`Stderr: ${error.stderr}`);
        return { success: false, error: error.message };
    }
}

async function batchConvert() {
    // Check if input directory exists
    if (!fs.existsSync(CONFIG.inputDir)) {
        console.error(`❌ Input directory not found: ${CONFIG.inputDir}`);
        console.log('   Create a "maps-in" folder and place .prk files inside.');
        return;
    }

    const files = fs.readdirSync(CONFIG.inputDir)
        .filter(f => CONFIG.supportedExtensions.includes(path.extname(f)));

    if (files.length === 0) {
        console.log('No .prk files found in input directory.');
        console.log(`Looking in: ${CONFIG.inputDir}`);
        return;
    }

    console.log(`📦 Found ${files.length} map(s) to convert`);
    console.log('━'.repeat(50));

    const results = [];
    for (const file of files) {
        const result = await convertMap(file);
        results.push({ file, ...result });
    }

    // Summary
    console.log('\n' + '━'.repeat(50));
    console.log('📊 CONVERSION SUMMARY');
    console.log('━'.repeat(50));
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    results.forEach(r => {
        const status = r.success ? '✅' : '❌';
        const detail = r.success ? `(${(r.size / 1024).toFixed(1)} KB)` : r.error;
        console.log(`${status} ${r.file} → ${detail}`);
    });

    console.log(`\n${successCount} succeeded, ${failCount} failed out of ${results.length} total.`);

    // Generate manifest for web loading
    if (successCount > 0) {
        generateManifest(results.filter(r => r.success));
    }
}

function generateManifest(successfulResults) {
    const manifest = {
        version: 1,
        maps: successfulResults.map(r => ({
            name: path.parse(r.file).name,
            file: path.basename(r.outputPath),
            size: r.size,
            source: r.file,
        })),
        generated: new Date().toISOString(),
    };

    const manifestPath = path.join(CONFIG.outputDir, 'maps-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`\n📋 Generated manifest: ${manifestPath}`);
}

// CLI interface
const args = process.argv.slice(2);
if (args.length === 0) {
    // Batch convert all
    batchConvert();
} else if (args.length === 1) {
    // Single file
    convertMap(args[0]).then(result => {
        if (result.success) {
            generateManifest([{ ...result, file: args[0] }]);
        }
    });
} else if (args.length === 2) {
    // Input + custom output name
    convertMap(args[0], args[1]).then(result => {
        if (result.success) {
            generateManifest([{ ...result, file: args[0] }]);
        }
    });
} else {
    console.log('THPS Map Converter Pipeline');
    console.log('Usage (from project root):');
    console.log('  node tools/map-pipeline/pipeline.js                        # Convert all .prk files in maps-in/');
    console.log('  node tools/map-pipeline/pipeline.js Braille.PRK            # Convert single file');
    console.log('  node tools/map-pipeline/pipeline.js Braille.PRK custom.glb  # Custom output name');
    console.log('  npm run convert:map -- Braille.PRK                         # Via npm script');
}