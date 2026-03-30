// ---------------------------------------------------------------------------
// Azure DR Blueprint Generator – VS Code Extension Entry Point
//
// Supports two paths:
//   1. Local files: analyse .bicep / ARM .json on disk
//   2. Live Azure:  connect → pick subscription → pick RGs → export → analyse
// ---------------------------------------------------------------------------
import * as vscode from 'vscode';
import * as path from 'path';
import { ExtensionConfig, AnalysisResult, DetectedResource } from './models/types';
import {
    scanAndParseFiles,
    parseSingleFile,
    runAnalysis,
    generateFullBlueprint,
    writeArtifacts,
} from './generators/blueprintOrchestrator';
import { generateFailoverRunbook } from './generators/failoverRunbook';
import { generateTestScheduler } from './generators/testScheduler';
import { generateComplianceReport } from './generators/complianceReport';
import { OUTPUT_CHANNEL_NAME } from './utils/constants';
import { getRegionDisplayName } from './utils/regionPairs';
import {
    isAzCliInstalled,
    isLoggedIn,
    azLogin,
    listSubscriptions,
    setSubscription,
    listResourceGroups,
    exportAndParse,
    AzureSubscription,
    AzureResourceGroup,
} from './azure/azureExporter';

let outputChannel: vscode.OutputChannel;
let lastAnalysis: AnalysisResult | undefined;

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function getConfig(): ExtensionConfig {
    const cfg = vscode.workspace.getConfiguration('drBlueprint');
    return {
        defaultRpoMinutes: cfg.get<number>('defaultRpoMinutes', 15),
        defaultRtoMinutes: cfg.get<number>('defaultRtoMinutes', 60),
        outputFolder: cfg.get<string>('outputFolder', 'dr-blueprint'),
        complianceFrameworks: cfg.get<string[]>('complianceFrameworks', ['SOC2', 'ISO27001', 'HIPAA']),
        backupRetentionDays: cfg.get<number>('backupRetentionDays', 30),
        testScheduleCron: cfg.get<string>('testScheduleCron', '0 2 1 */3 *'),
    };
}

function getWorkspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage(
            'No workspace folder open. Please open a folder first (it can be empty — the extension will write exported files into it).'
        );
        return undefined;
    }
    return folders[0].uri.fsPath;
}

/** Display the analysis result in the Output channel */
function showAnalysisOutput(analysis: AnalysisResult, source: string) {
    outputChannel.clear();
    outputChannel.appendLine('═══════════════════════════════════════════');
    outputChannel.appendLine('  Azure DR Blueprint – Infrastructure Analysis');
    outputChannel.appendLine('═══════════════════════════════════════════');
    outputChannel.appendLine('');
    outputChannel.appendLine(`Source:           ${source}`);
    outputChannel.appendLine(`Primary Region:   ${getRegionDisplayName(analysis.primaryRegion)} (${analysis.primaryRegion})`);
    outputChannel.appendLine(`Paired DR Region: ${getRegionDisplayName(analysis.pairedRegion)} (${analysis.pairedRegion})`);
    outputChannel.appendLine(`Files Analysed:   ${analysis.sourceFiles.length}`);
    outputChannel.appendLine(`Resources Found:  ${analysis.resources.length}`);
    outputChannel.appendLine('');
    outputChannel.appendLine('Detected Workloads:');
    for (const w of analysis.workloads) {
        outputChannel.appendLine(`  • ${w.type}: ${w.resources.length} resource(s) — RPO ${w.recommendedRpoMinutes}min / RTO ${w.recommendedRtoMinutes}min`);
        for (const r of w.resources) {
            outputChannel.appendLine(`      - ${r.name || r.symbolicName} (${r.resourceType})`);
        }
    }
    outputChannel.appendLine('');
    outputChannel.appendLine('Run "DR Blueprint: Generate Full DR Blueprint" to produce all DR artifacts.');
    outputChannel.show();
}

/** Display generation results in the Output channel */
function showGenerationOutput(outputDir: string, artifacts: { relativePath: string; description: string }[]) {
    outputChannel.clear();
    outputChannel.appendLine('═══════════════════════════════════════════');
    outputChannel.appendLine('  Azure DR Blueprint – Generation Complete');
    outputChannel.appendLine('═══════════════════════════════════════════');
    outputChannel.appendLine('');
    outputChannel.appendLine(`Output folder: ${outputDir}`);
    outputChannel.appendLine('');
    outputChannel.appendLine('Generated artifacts:');
    for (const a of artifacts) {
        outputChannel.appendLine(`  ✓ ${a.relativePath} — ${a.description}`);
    }
    outputChannel.appendLine('');
    outputChannel.appendLine('Next steps:');
    outputChannel.appendLine('  1. Review generated Bicep files and adjust parameters');
    outputChannel.appendLine('  2. Deploy DR resources: az deployment group create -g <rg> -f <file.bicep>');
    outputChannel.appendLine('  3. Configure ASR replication for each VM');
    outputChannel.appendLine('  4. Test failover: .\\dr-test-scheduler.ps1');
    outputChannel.appendLine('  5. Schedule recurring DR tests');
    outputChannel.show();
}

// ═══════════════════════════════════════════════════════════════════════════
// Source picker — the core of the dual-path flow
// ═══════════════════════════════════════════════════════════════════════════

type InfraSource = 'local' | 'azure';

async function pickInfrastructureSource(): Promise<InfraSource | undefined> {
    const items: vscode.QuickPickItem[] = [
        {
            label: '$(file-code)  From Local Files',
            description: 'Analyze .bicep and ARM .json files in the current workspace',
            detail: 'Use this if you already have infrastructure-as-code templates on disk',
        },
        {
            label: '$(cloud)  From Live Azure Subscription',
            description: 'Connect to Azure, export your running infrastructure, then analyze',
            detail: 'Use this if you have a running Azure workload but no template files',
        },
    ];

    const pick = await vscode.window.showQuickPick(items, {
        title: 'DR Blueprint — Choose Infrastructure Source',
        placeHolder: 'Where is your Azure infrastructure defined?',
    });

    if (!pick) { return undefined; }
    return pick.label.includes('Local') ? 'local' : 'azure';
}

// ═══════════════════════════════════════════════════════════════════════════
// Live Azure flow
// ═══════════════════════════════════════════════════════════════════════════

async function ensureAzureReady(): Promise<boolean> {
    const cliOk = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'DR Blueprint: Checking Azure CLI...' },
        () => isAzCliInstalled()
    );

    if (!cliOk) {
        const action = await vscode.window.showErrorMessage(
            'Azure CLI is not installed or not on PATH. The extension needs `az` to export live infrastructure.',
            'Install Azure CLI',
            'Cancel'
        );
        if (action === 'Install Azure CLI') {
            vscode.env.openExternal(vscode.Uri.parse('https://learn.microsoft.com/en-us/cli/azure/install-azure-cli'));
        }
        return false;
    }

    const loggedIn = await isLoggedIn();
    if (loggedIn) { return true; }

    const loginChoice = await vscode.window.showInformationMessage(
        'You are not signed into Azure. Sign in now to export your infrastructure.',
        'Sign In to Azure',
        'Cancel'
    );
    if (loginChoice !== 'Sign In to Azure') { return false; }

    const loginOk = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'DR Blueprint: Signing into Azure (check your browser)...' },
        () => azLogin()
    );

    if (!loginOk) {
        vscode.window.showErrorMessage('Azure sign-in failed or was cancelled.');
        return false;
    }

    vscode.window.showInformationMessage('Signed into Azure successfully.');
    return true;
}

async function pickSubscription(): Promise<AzureSubscription | undefined> {
    const subs = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'DR Blueprint: Loading subscriptions...' },
        () => listSubscriptions()
    );

    if (subs.length === 0) {
        vscode.window.showErrorMessage('No Azure subscriptions found for your account.');
        return undefined;
    }

    if (subs.length === 1) { return subs[0]; }

    const items = subs.map(s => ({
        label: s.name,
        description: s.id,
        detail: s.isDefault ? '★ current default subscription' : undefined,
        sub: s,
    }));

    const pick = await vscode.window.showQuickPick(items, {
        title: 'DR Blueprint — Select Azure Subscription',
        placeHolder: 'Choose the subscription containing your workload',
    });

    return pick?.sub;
}

interface RGPickItem extends vscode.QuickPickItem {
    rg: AzureResourceGroup;
}

async function pickResourceGroups(): Promise<AzureResourceGroup[] | undefined> {
    const rgs = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'DR Blueprint: Loading resource groups...' },
        () => listResourceGroups()
    );

    if (rgs.length === 0) {
        vscode.window.showErrorMessage('No resource groups found in this subscription.');
        return undefined;
    }

    const items: RGPickItem[] = rgs.map(g => ({
        label: g.name,
        description: g.location,
        rg: g,
        picked: false,
    }));

    const allItem: RGPickItem = {
        label: '$(checklist) Select All Resource Groups',
        description: `(${rgs.length} total)`,
        rg: { name: '__ALL__', location: '' },
        picked: false,
    };

    const picks = await vscode.window.showQuickPick([allItem, ...items], {
        title: 'DR Blueprint — Select Resource Groups to Export',
        placeHolder: 'Pick the resource groups that make up your workload (multi-select)',
        canPickMany: true,
    });

    if (!picks || picks.length === 0) { return undefined; }

    if (picks.some(p => p.rg.name === '__ALL__')) {
        return rgs;
    }

    return picks.map(p => p.rg);
}

async function runLiveAzureExport(workspaceRoot: string): Promise<{
    resources: DetectedResource[];
    sourceFiles: string[];
    source: string;
} | undefined> {
    const ready = await ensureAzureReady();
    if (!ready) { return undefined; }

    const sub = await pickSubscription();
    if (!sub) { return undefined; }

    await setSubscription(sub.id);
    outputChannel.appendLine(`\nSubscription: ${sub.name} (${sub.id})`);

    const selectedRGs = await pickResourceGroups();
    if (!selectedRGs || selectedRGs.length === 0) { return undefined; }

    outputChannel.appendLine(`Resource groups: ${selectedRGs.map(rg => rg.name).join(', ')}`);

    const exportResult = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'DR Blueprint: Exporting from Azure...',
            cancellable: false,
        },
        async (progress) => {
            return exportAndParse(
                sub.id,
                sub.name,
                selectedRGs.map(rg => rg.name),
                workspaceRoot,
                (msg) => {
                    progress.report({ message: msg });
                    outputChannel.appendLine(`  ${msg}`);
                },
            );
        }
    );

    if (exportResult.allResources.length === 0) {
        vscode.window.showWarningMessage(
            'No Azure resources could be exported. The selected resource groups may be empty or the export may have failed. Check the Output panel for details.'
        );
        return undefined;
    }

    const rgNames = exportResult.resourceGroups.map(g => g.resourceGroupName).join(', ');

    return {
        resources: exportResult.allResources,
        sourceFiles: exportResult.allSourceFiles,
        source: `Live Azure export — ${sub.name} — [${rgNames}]`,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// Local files pipeline
// ═══════════════════════════════════════════════════════════════════════════

function runLocalFileScan(workspaceRoot: string): {
    resources: DetectedResource[];
    sourceFiles: string[];
    source: string;
} | undefined {
    const { resources, sourceFiles } = scanAndParseFiles(workspaceRoot);
    if (resources.length === 0) { return undefined; }
    return { resources, sourceFiles, source: `Local files (${sourceFiles.length} files)` };
}

// ═══════════════════════════════════════════════════════════════════════════
// Unified source resolver
// ═══════════════════════════════════════════════════════════════════════════

async function resolveInfrastructureSource(workspaceRoot: string): Promise<{
    resources: DetectedResource[];
    sourceFiles: string[];
    source: string;
} | undefined> {
    const localResult = runLocalFileScan(workspaceRoot);
    const hasLocalFiles = localResult !== undefined && localResult.resources.length > 0;

    if (hasLocalFiles) {
        // Local files exist — offer a choice
        const source = await pickInfrastructureSource();
        if (!source) { return undefined; }

        if (source === 'local') {
            return localResult;
        }
        return runLiveAzureExport(workspaceRoot);
    }

    // No local template files — automatically offer Azure export
    const goAzure = await vscode.window.showInformationMessage(
        'No Bicep or ARM template files found in this workspace. Connect to your live Azure subscription to export and analyze your infrastructure?',
        'Connect to Azure',
        'Cancel'
    );

    if (goAzure !== 'Connect to Azure') { return undefined; }
    return runLiveAzureExport(workspaceRoot);
}

// ═══════════════════════════════════════════════════════════════════════════
// Commands
// ═══════════════════════════════════════════════════════════════════════════

async function cmdAnalyzeInfrastructure() {
    const root = getWorkspaceRoot();
    if (!root) { return; }
    const config = getConfig();

    const resolved = await resolveInfrastructureSource(root);
    if (!resolved) { return; }

    const analysis = runAnalysis(resolved.resources, resolved.sourceFiles, config);
    lastAnalysis = analysis;

    showAnalysisOutput(analysis, resolved.source);

    vscode.window.showInformationMessage(
        `DR Blueprint: Found ${analysis.resources.length} resource(s) across ${analysis.workloads.length} workload type(s). See Output panel.`
    );
}

async function cmdGenerateBlueprint() {
    const root = getWorkspaceRoot();
    if (!root) { return; }
    const config = getConfig();

    if (!lastAnalysis) {
        const resolved = await resolveInfrastructureSource(root);
        if (!resolved) { return; }
        lastAnalysis = runAnalysis(resolved.resources, resolved.sourceFiles, config);
    }

    const blueprint = generateFullBlueprint(lastAnalysis, config);
    const outputDir = path.join(root, config.outputFolder);
    const writtenFiles = writeArtifacts(outputDir, blueprint.artifacts);

    showGenerationOutput(outputDir, blueprint.artifacts);

    vscode.window.showInformationMessage(
        `DR Blueprint: Generated ${writtenFiles.length} artifact(s) in "${config.outputFolder}/" folder.`,
        'Open Folder'
    ).then(selection => {
        if (selection === 'Open Folder') {
            vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(outputDir));
        }
    });
}

async function cmdGenerateFromAzure() {
    const root = getWorkspaceRoot();
    if (!root) { return; }
    const config = getConfig();

    // Skip the source picker — go straight to Azure
    const azureResult = await runLiveAzureExport(root);
    if (!azureResult) { return; }

    const analysis = runAnalysis(azureResult.resources, azureResult.sourceFiles, config);
    lastAnalysis = analysis;

    showAnalysisOutput(analysis, azureResult.source);

    const action = await vscode.window.showInformationMessage(
        `Found ${analysis.resources.length} resource(s) across ${analysis.workloads.length} workload type(s) from live Azure. Generate DR blueprint now?`,
        'Generate Blueprint',
        'Review First'
    );

    if (action === 'Generate Blueprint') {
        const blueprint = generateFullBlueprint(analysis, config);
        const outputDir = path.join(root, config.outputFolder);
        const writtenFiles = writeArtifacts(outputDir, blueprint.artifacts);

        showGenerationOutput(outputDir, blueprint.artifacts);

        vscode.window.showInformationMessage(
            `DR Blueprint: Generated ${writtenFiles.length} artifact(s) in "${config.outputFolder}/" folder.`,
            'Open Folder'
        ).then(selection => {
            if (selection === 'Open Folder') {
                vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(outputDir));
            }
        });
    }
}

async function cmdGenerateFailoverRunbook() {
    const root = getWorkspaceRoot();
    if (!root) { return; }
    const config = getConfig();

    if (!lastAnalysis) {
        const resolved = await resolveInfrastructureSource(root);
        if (!resolved) { return; }
        lastAnalysis = runAnalysis(resolved.resources, resolved.sourceFiles, config);
    }

    const artifact = generateFailoverRunbook(lastAnalysis);
    writeArtifacts(path.join(root, config.outputFolder), [artifact]);

    vscode.window.showInformationMessage(
        `DR Blueprint: Failover runbook generated at ${config.outputFolder}/${artifact.relativePath}`
    );
}

async function cmdGenerateTestSchedule() {
    const root = getWorkspaceRoot();
    if (!root) { return; }
    const config = getConfig();

    if (!lastAnalysis) {
        const resolved = await resolveInfrastructureSource(root);
        if (!resolved) { return; }
        lastAnalysis = runAnalysis(resolved.resources, resolved.sourceFiles, config);
    }

    const artifact = generateTestScheduler(lastAnalysis, config.testScheduleCron);
    writeArtifacts(path.join(root, config.outputFolder), [artifact]);

    vscode.window.showInformationMessage(
        `DR Blueprint: Test scheduler generated at ${config.outputFolder}/${artifact.relativePath}`
    );
}

async function cmdGenerateComplianceReport() {
    const root = getWorkspaceRoot();
    if (!root) { return; }
    const config = getConfig();

    if (!lastAnalysis) {
        const resolved = await resolveInfrastructureSource(root);
        if (!resolved) { return; }
        lastAnalysis = runAnalysis(resolved.resources, resolved.sourceFiles, config);
    }

    const artifact = generateComplianceReport(
        lastAnalysis, config.complianceFrameworks, config.testScheduleCron, config.backupRetentionDays,
    );
    const outputDir = path.join(root, config.outputFolder);
    writeArtifacts(outputDir, [artifact]);

    const doc = await vscode.workspace.openTextDocument(path.join(outputDir, artifact.relativePath));
    await vscode.window.showTextDocument(doc);

    vscode.window.showInformationMessage(
        `DR Blueprint: Compliance report generated at ${config.outputFolder}/${artifact.relativePath}`
    );
}

async function cmdAnalyzeCurrentFile(uri?: vscode.Uri) {
    const filePath = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) {
        vscode.window.showWarningMessage('No file selected. Open a .bicep or .json file first.');
        return;
    }
    if (!filePath.endsWith('.bicep') && !filePath.endsWith('.json')) {
        vscode.window.showWarningMessage('Selected file must be a .bicep or .json ARM template.');
        return;
    }

    const config = getConfig();
    const resources = parseSingleFile(filePath);

    if (resources.length === 0) {
        vscode.window.showWarningMessage(`No Azure resources detected in ${path.basename(filePath)}.`);
        return;
    }

    const analysis = runAnalysis(resources, [filePath], config);
    lastAnalysis = analysis;

    outputChannel.clear();
    outputChannel.appendLine(`File: ${filePath}`);
    outputChannel.appendLine(`Resources: ${resources.length}`);
    outputChannel.appendLine(`Primary Region: ${getRegionDisplayName(analysis.primaryRegion)}`);
    outputChannel.appendLine(`DR Region: ${getRegionDisplayName(analysis.pairedRegion)}`);
    outputChannel.appendLine('');
    for (const w of analysis.workloads) {
        outputChannel.appendLine(`${w.type}: ${w.resources.length} resource(s)`);
        for (const r of w.resources) {
            outputChannel.appendLine(`  - ${r.name || r.symbolicName} (${r.resourceType})`);
        }
    }
    outputChannel.show();

    const action = await vscode.window.showInformationMessage(
        `Found ${resources.length} resource(s) in ${path.basename(filePath)}. Generate DR blueprint?`,
        'Generate Blueprint', 'Cancel'
    );
    if (action === 'Generate Blueprint') {
        await cmdGenerateBlueprint();
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Activation
// ═══════════════════════════════════════════════════════════════════════════

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);

    context.subscriptions.push(
        vscode.commands.registerCommand('drBlueprint.analyzeInfrastructure', cmdAnalyzeInfrastructure),
        vscode.commands.registerCommand('drBlueprint.generateBlueprint', cmdGenerateBlueprint),
        vscode.commands.registerCommand('drBlueprint.generateFromAzure', cmdGenerateFromAzure),
        vscode.commands.registerCommand('drBlueprint.generateFailoverRunbook', cmdGenerateFailoverRunbook),
        vscode.commands.registerCommand('drBlueprint.generateTestSchedule', cmdGenerateTestSchedule),
        vscode.commands.registerCommand('drBlueprint.generateComplianceReport', cmdGenerateComplianceReport),
        vscode.commands.registerCommand('drBlueprint.analyzeCurrentFile', cmdAnalyzeCurrentFile),
        outputChannel,
    );

    outputChannel.appendLine('Azure DR Blueprint Generator activated.');
}

export function deactivate() {
    lastAnalysis = undefined;
}
