// ---------------------------------------------------------------------------
// Blueprint Orchestrator – coordinates parsing, detection, and generation
// ---------------------------------------------------------------------------
import * as fs from 'fs';
import * as path from 'path';
import { parseBicepContent } from '../parsers/bicepParser';
import { parseArmContent } from '../parsers/armParser';
import { analyzeResources } from '../parsers/workloadDetector';
import { generateAsrPolicy } from './asrPolicy';
import { generateBackupPolicy } from './backupPolicy';
import { generateTrafficManager } from './trafficManager';
import { generatePairedRegionResources } from './pairedRegion';
import { generateFailoverRunbook } from './failoverRunbook';
import { generateTestScheduler } from './testScheduler';
import { generateComplianceReport } from './complianceReport';
import { generateNetworkingDr } from './networkingDr';
import { generateFrontDoorDr } from './frontDoorDr';
import {
    DetectedResource,
    AnalysisResult,
    DRBlueprint,
    GeneratedArtifact,
    ExtensionConfig,
} from '../models/types';

/**
 * Scan a workspace folder for .bicep and ARM .json files and parse them all.
 */
export function scanAndParseFiles(workspaceRoot: string): {
    resources: DetectedResource[];
    sourceFiles: string[];
} {
    const resources: DetectedResource[] = [];
    const sourceFiles: string[] = [];

    function walk(dir: string) {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return; // Skip inaccessible directories
        }
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                // Skip common non-source directories
                if (['node_modules', '.git', 'out', 'bin', 'obj', '.vscode-test'].includes(entry.name)) {
                    continue;
                }
                walk(fullPath);
            } else if (entry.isFile()) {
                if (entry.name.endsWith('.bicep')) {
                    try {
                        const content = fs.readFileSync(fullPath, 'utf-8');
                        const parsed = parseBicepContent(content, fullPath);
                        if (parsed.length > 0) {
                            resources.push(...parsed);
                            sourceFiles.push(fullPath);
                        }
                    } catch { /* skip unreadable files */ }
                } else if (entry.name.endsWith('.json') && !entry.name.includes('package') && !entry.name.includes('tsconfig') && !entry.name.includes('launch')) {
                    try {
                        const content = fs.readFileSync(fullPath, 'utf-8');
                        const parsed = parseArmContent(content, fullPath);
                        if (parsed.length > 0) {
                            resources.push(...parsed);
                            sourceFiles.push(fullPath);
                        }
                    } catch { /* skip unreadable files */ }
                }
            }
        }
    }

    walk(workspaceRoot);
    return { resources, sourceFiles };
}

/**
 * Parse a single file (Bicep or ARM JSON).
 */
export function parseSingleFile(filePath: string): DetectedResource[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (filePath.endsWith('.bicep')) {
        return parseBicepContent(content, filePath);
    }
    if (filePath.endsWith('.json')) {
        return parseArmContent(content, filePath);
    }
    return [];
}

/**
 * Run the full analysis on detected resources.
 */
export function runAnalysis(
    resources: DetectedResource[],
    sourceFiles: string[],
    config: ExtensionConfig,
): AnalysisResult {
    return analyzeResources(resources, sourceFiles, config.defaultRpoMinutes, config.defaultRtoMinutes);
}

/**
 * Generate the complete DR Blueprint from an analysis result.
 */
export function generateFullBlueprint(
    analysis: AnalysisResult,
    config: ExtensionConfig,
): DRBlueprint {
    const artifacts: GeneratedArtifact[] = [];

    // ASR Policy (only if VMs detected)
    const asr = generateAsrPolicy(analysis);
    if (asr) { artifacts.push(asr); }

    // Backup Vault & Policies
    if (analysis.workloads.length > 0) {
        artifacts.push(generateBackupPolicy(analysis, config.backupRetentionDays));
    }

    // Traffic Manager Failover
    if (analysis.workloads.length > 0) {
        artifacts.push(generateTrafficManager(analysis));
    }

    // Paired Region Resources
    if (analysis.workloads.length > 0) {
        artifacts.push(generatePairedRegionResources(analysis));
    }

    // Networking DR (VNets, NSGs, Firewalls, Gateways, etc.)
    const netDr = generateNetworkingDr(analysis);
    if (netDr) { artifacts.push(netDr); }

    // Front Door DR (global failover with WAF for web workloads)
    const fdDr = generateFrontDoorDr(analysis);
    if (fdDr) { artifacts.push(fdDr); }

    // Failover Runbook
    if (analysis.workloads.length > 0) {
        artifacts.push(generateFailoverRunbook(analysis));
    }

    // DR Test Scheduler
    if (analysis.workloads.length > 0) {
        artifacts.push(generateTestScheduler(analysis, config.testScheduleCron));
    }

    // Compliance Report
    artifacts.push(generateComplianceReport(
        analysis,
        config.complianceFrameworks,
        config.testScheduleCron,
        config.backupRetentionDays,
    ));

    return { analysis, artifacts };
}

/**
 * Write all generated artifacts to disk under the output folder.
 */
export function writeArtifacts(
    outputDir: string,
    artifacts: GeneratedArtifact[],
): string[] {
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const writtenFiles: string[] = [];
    for (const artifact of artifacts) {
        const fullPath = path.join(outputDir, artifact.relativePath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, artifact.content, 'utf-8');
        writtenFiles.push(fullPath);
    }
    return writtenFiles;
}
