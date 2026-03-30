// ---------------------------------------------------------------------------
// Azure CLI Exporter – connects to live Azure subscriptions, exports
// resource group templates, and returns DetectedResource[] objects
// that feed into the existing analysis pipeline.
// ---------------------------------------------------------------------------
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DetectedResource } from '../models/types';
import { parseArmContent } from '../parsers/armParser';

/** Result of an `az` CLI invocation */
interface AzCliResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
}

/** Azure subscription from `az account list` */
export interface AzureSubscription {
    id: string;
    name: string;
    isDefault: boolean;
    state: string;
    tenantId: string;
}

/** Azure resource group from `az group list` */
export interface AzureResourceGroup {
    name: string;
    location: string;
    /** resource count from `az resource list --resource-group` */
    resourceCount?: number;
}

/** Exported resource group with parsed resources */
export interface ExportedResourceGroup {
    resourceGroupName: string;
    location: string;
    resources: DetectedResource[];
    exportedFilePath: string;
}

/** Full result of a live Azure export */
export interface LiveExportResult {
    subscriptionId: string;
    subscriptionName: string;
    resourceGroups: ExportedResourceGroup[];
    allResources: DetectedResource[];
    allSourceFiles: string[];
    exportDir: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Azure CLI wrapper
// ─────────────────────────────────────────────────────────────────────────

/**
 * Execute an Azure CLI command and return structured output.
 * Timeout: 120 seconds (exports can be slow for large resource groups).
 */
function execAzCli(args: string, timeoutMs: number = 120_000): Promise<AzCliResult> {
    return new Promise((resolve) => {
        cp.exec(`az ${args}`, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            resolve({
                success: !error,
                stdout: stdout?.toString() ?? '',
                stderr: stderr?.toString() ?? '',
                exitCode: error?.code ?? 0,
            });
        });
    });
}

/**
 * Check if Azure CLI is installed and accessible.
 */
export async function isAzCliInstalled(): Promise<boolean> {
    const result = await execAzCli('version --output json', 10_000);
    return result.success;
}

/**
 * Check if the user has an active Azure session.
 */
export async function isLoggedIn(): Promise<boolean> {
    const result = await execAzCli('account show --output json', 15_000);
    return result.success && result.stdout.includes('"id"');
}

/**
 * Trigger interactive `az login`. Opens a browser for authentication.
 * Returns true if login succeeded.
 */
export async function azLogin(): Promise<boolean> {
    const result = await execAzCli('login --output json', 300_000); // 5 min for browser auth
    return result.success;
}

/**
 * List all Azure subscriptions the logged-in user has access to.
 */
export async function listSubscriptions(): Promise<AzureSubscription[]> {
    const result = await execAzCli('account list --output json --query "[].{id:id, name:name, isDefault:isDefault, state:state, tenantId:tenantId}"');
    if (!result.success) { return []; }
    try {
        const raw = JSON.parse(result.stdout);
        if (!Array.isArray(raw)) { return []; }
        return raw.map((s: Record<string, unknown>) => ({
            id: String(s.id ?? ''),
            name: String(s.name ?? ''),
            isDefault: Boolean(s.isDefault),
            state: String(s.state ?? ''),
            tenantId: String(s.tenantId ?? ''),
        }));
    } catch {
        return [];
    }
}

/**
 * Set the active subscription for subsequent commands.
 */
export async function setSubscription(subscriptionId: string): Promise<boolean> {
    const result = await execAzCli(`account set --subscription "${subscriptionId}"`);
    return result.success;
}

/**
 * List resource groups in the active subscription, with resource counts.
 */
export async function listResourceGroups(): Promise<AzureResourceGroup[]> {
    const result = await execAzCli('group list --output json --query "[].{name:name, location:location}"');
    if (!result.success) { return []; }
    try {
        const raw = JSON.parse(result.stdout);
        if (!Array.isArray(raw)) { return []; }
        return raw.map((g: Record<string, unknown>) => ({
            name: String(g.name ?? ''),
            location: String(g.location ?? ''),
        }));
    } catch {
        return [];
    }
}

/**
 * Get the count of resources in a resource group.
 */
export async function getResourceCount(resourceGroupName: string): Promise<number> {
    const result = await execAzCli(
        `resource list --resource-group "${resourceGroupName}" --output json --query "length(@)"`
    );
    if (!result.success) { return 0; }
    try {
        return parseInt(result.stdout.trim(), 10) || 0;
    } catch {
        return 0;
    }
}

/**
 * Export a resource group's ARM template using Azure CLI.
 *
 * Uses `az group export` which captures the **current state** of all resources
 * including their full configuration, dependencies, and settings — a "digital
 * lifeboat" snapshot of the infrastructure.
 *
 * If `az group export` fails (it can for some resource types), falls back to
 * `az resource list` which gives resource metadata without full properties.
 */
export async function exportResourceGroup(
    resourceGroupName: string,
    outputDir: string,
    onProgress?: (message: string) => void,
): Promise<ExportedResourceGroup | undefined> {
    const safeRgName = resourceGroupName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const exportFilePath = path.join(outputDir, `${safeRgName}-export.json`);

    onProgress?.(`Exporting resource group "${resourceGroupName}"...`);

    // Attempt 1: Full ARM export (captures complete configuration)
    const exportResult = await execAzCli(
        `group export --name "${resourceGroupName}" --include-parameter-default-value --output json`,
        180_000 // 3 minutes — large RGs can be slow
    );

    if (exportResult.success && exportResult.stdout.trim().startsWith('{')) {
        fs.writeFileSync(exportFilePath, exportResult.stdout, 'utf-8');
        onProgress?.(`Exported "${resourceGroupName}" (full ARM template)`);

        const resources = parseArmContent(exportResult.stdout, exportFilePath);
        const rgLocation = await getResourceGroupLocation(resourceGroupName);

        return {
            resourceGroupName,
            location: rgLocation,
            resources,
            exportedFilePath: exportFilePath,
        };
    }

    // Attempt 2: Fallback to resource list (metadata only, but always works)
    onProgress?.(`Full export unavailable for "${resourceGroupName}", falling back to resource list...`);
    const listResult = await execAzCli(
        `resource list --resource-group "${resourceGroupName}" --output json`
    );

    if (!listResult.success) {
        onProgress?.(`Failed to export "${resourceGroupName}": ${exportResult.stderr || listResult.stderr}`);
        return undefined;
    }

    try {
        const rawResources = JSON.parse(listResult.stdout);
        if (!Array.isArray(rawResources)) { return undefined; }

        // Build a synthetic ARM template from the resource list
        const syntheticTemplate = {
            $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
            contentVersion: '1.0.0.0',
            resources: rawResources.map((r: Record<string, unknown>) => ({
                type: r.type,
                apiVersion: r.apiVersion || '2023-01-01',
                name: r.name,
                location: r.location,
                properties: {},
            })),
        };

        const content = JSON.stringify(syntheticTemplate, null, 2);
        fs.writeFileSync(exportFilePath, content, 'utf-8');
        onProgress?.(`Exported "${resourceGroupName}" (resource metadata)`);

        const resources = parseArmContent(content, exportFilePath);
        const rgLocation = typeof rawResources[0]?.location === 'string'
            ? rawResources[0].location
            : '';

        return {
            resourceGroupName,
            location: rgLocation,
            resources,
            exportedFilePath: exportFilePath,
        };
    } catch {
        onProgress?.(`Failed to parse resource list for "${resourceGroupName}"`);
        return undefined;
    }
}

/**
 * Get the location of a resource group.
 */
async function getResourceGroupLocation(name: string): Promise<string> {
    const result = await execAzCli(`group show --name "${name}" --query location --output tsv`);
    return result.success ? result.stdout.trim() : '';
}

/**
 * Full pipeline: export one or more resource groups and return
 * all resources + source files ready for analysis.
 */
export async function exportAndParse(
    subscriptionId: string,
    subscriptionName: string,
    resourceGroupNames: string[],
    workspaceRoot: string,
    onProgress?: (message: string) => void,
): Promise<LiveExportResult> {
    // Create export directory inside workspace
    const exportDir = path.join(workspaceRoot, '.dr-blueprint-exports');
    if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
    }

    const exported: ExportedResourceGroup[] = [];
    const allResources: DetectedResource[] = [];
    const allSourceFiles: string[] = [];

    for (const rgName of resourceGroupNames) {
        const result = await exportResourceGroup(rgName, exportDir, onProgress);
        if (result && result.resources.length > 0) {
            exported.push(result);
            allResources.push(...result.resources);
            allSourceFiles.push(result.exportedFilePath);
        }
    }

    return {
        subscriptionId,
        subscriptionName,
        resourceGroups: exported,
        allResources,
        allSourceFiles,
        exportDir,
    };
}
