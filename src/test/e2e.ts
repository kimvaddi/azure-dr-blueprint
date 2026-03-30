// ---------------------------------------------------------------------------
// End-to-end test – runs the full orchestrator against examples/ and writes
// output to a temp directory, then validates all files exist and are non-empty.
// ---------------------------------------------------------------------------
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
    scanAndParseFiles,
    runAnalysis,
    generateFullBlueprint,
    writeArtifacts,
} from '../generators/blueprintOrchestrator';
import { ExtensionConfig } from '../models/types';

const EXAMPLES_DIR = path.resolve(__dirname, '../../examples');
const OUTPUT_DIR = path.join(os.tmpdir(), 'dr-blueprint-e2e-test');

function assert(condition: boolean, msg: string) {
    if (!condition) {
        console.error(`  ✗ FAIL: ${msg}`);
        process.exitCode = 1;
    } else {
        console.log(`  ✓ PASS: ${msg}`);
    }
}

// Clean up previous run
if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true });
}

const config: ExtensionConfig = {
    defaultRpoMinutes: 15,
    defaultRtoMinutes: 60,
    outputFolder: 'dr-blueprint',
    complianceFrameworks: ['SOC2', 'ISO27001', 'HIPAA'],
    backupRetentionDays: 30,
    testScheduleCron: '0 2 1 */3 *',
};

console.log('\n═══ End-to-End Test: Full Blueprint Generation ═══\n');

// Step 1: Scan examples directory
console.log('Step 1: Scanning examples directory...');
const { resources, sourceFiles } = scanAndParseFiles(EXAMPLES_DIR);
assert(resources.length > 0, `Scanned ${resources.length} resources from ${sourceFiles.length} files`);

// Step 2: Analyze
console.log('\nStep 2: Running workload analysis...');
const analysis = runAnalysis(resources, sourceFiles, config);
assert(analysis.workloads.length >= 5, `Detected ${analysis.workloads.length} workload types`);
console.log(`  Primary region: ${analysis.primaryRegion}`);
console.log(`  Paired region: ${analysis.pairedRegion}`);

// Step 3: Generate blueprint
console.log('\nStep 3: Generating full DR blueprint...');
const blueprint = generateFullBlueprint(analysis, config);
assert(blueprint.artifacts.length >= 7, `Generated ${blueprint.artifacts.length} artifacts`);

// Step 4: Write artifacts
console.log('\nStep 4: Writing artifacts to disk...');
const writtenFiles = writeArtifacts(OUTPUT_DIR, blueprint.artifacts);
assert(writtenFiles.length === blueprint.artifacts.length, `Wrote ${writtenFiles.length} files`);

// Step 5: Validate each file exists and is non-empty
console.log('\nStep 5: Validating output files...');
const expectedFiles = [
    'asr-replication-policy.bicep',
    'backup-vault-policy.bicep',
    'traffic-manager-failover.bicep',
    'paired-region-resources.bicep',
    'networking-dr.bicep',
    'failover-runbook.ps1',
    'dr-test-scheduler.ps1',
    'dr-compliance-report.md',
];

for (const file of expectedFiles) {
    const fullPath = path.join(OUTPUT_DIR, file);
    const exists = fs.existsSync(fullPath);
    assert(exists, `File exists: ${file}`);
    if (exists) {
        const stat = fs.statSync(fullPath);
        assert(stat.size > 500, `File ${file} has substantial content (${stat.size} bytes)`);
    }
}

// Step 6: Spot-check content quality
console.log('\nStep 6: Spot-checking content quality...');
const asrContent = fs.readFileSync(path.join(OUTPUT_DIR, 'asr-replication-policy.bicep'), 'utf-8');
assert(asrContent.includes('param primaryLocation'), 'ASR bicep has primary location param');
assert(asrContent.includes('param drLocation'), 'ASR bicep has DR location param');
assert(asrContent.includes('param rpoInMinutes'), 'ASR bicep has RPO param');

const runbookContent = fs.readFileSync(path.join(OUTPUT_DIR, 'failover-runbook.ps1'), 'utf-8');
assert(runbookContent.includes('[CmdletBinding()]'), 'Runbook has CmdletBinding');
assert(runbookContent.includes('param('), 'Runbook has parameter block');
assert(runbookContent.includes('.SYNOPSIS'), 'Runbook has help documentation');

const reportContent = fs.readFileSync(path.join(OUTPUT_DIR, 'dr-compliance-report.md'), 'utf-8');
assert(reportContent.includes('# Disaster Recovery Compliance Report'), 'Report has title');
assert(reportContent.includes('Executive Summary'), 'Report has executive summary');
assert(reportContent.includes('Failback Procedure'), 'Report has failback procedure');

const networkContent = fs.readFileSync(path.join(OUTPUT_DIR, 'networking-dr.bicep'), 'utf-8');
assert(networkContent.includes('Microsoft.Network/virtualNetworks'), 'Networking has DR VNet');
assert(networkContent.includes('Microsoft.Network/networkSecurityGroups'), 'Networking has DR NSG');
assert(networkContent.includes('param drLocation'), 'Networking has DR location param');
assert(reportContent.includes('networking-dr.bicep'), 'Compliance report references networking artifact');

// Summary
console.log('\n═══════════════════════════════════════════');
console.log(`Output directory: ${OUTPUT_DIR}`);
if (process.exitCode === 1) {
    console.log('E2E TEST: SOME TESTS FAILED');
} else {
    console.log('E2E TEST: ALL TESTS PASSED ✓');
}
console.log('═══════════════════════════════════════════\n');
