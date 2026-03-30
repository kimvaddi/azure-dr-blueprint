// ---------------------------------------------------------------------------
// Validation test – runs the parsers and generators against example files
// and verifies the output is non-empty and well-formed.
// ---------------------------------------------------------------------------
import * as path from 'path';
import * as fs from 'fs';
import { parseBicepContent } from '../parsers/bicepParser';
import { parseArmContent } from '../parsers/armParser';
import { analyzeResources } from '../parsers/workloadDetector';
import { generateAsrPolicy } from '../generators/asrPolicy';
import { generateBackupPolicy } from '../generators/backupPolicy';
import { generateTrafficManager } from '../generators/trafficManager';
import { generatePairedRegionResources } from '../generators/pairedRegion';
import { generateFailoverRunbook } from '../generators/failoverRunbook';
import { generateTestScheduler } from '../generators/testScheduler';
import { generateComplianceReport } from '../generators/complianceReport';
import { generateNetworkingDr } from '../generators/networkingDr';
import { generateFrontDoorDr } from '../generators/frontDoorDr';
import { RESOURCE_TYPE_WORKLOAD_MAP } from '../utils/constants';

const EXAMPLES_DIR = path.resolve(__dirname, '../../examples');

function assert(condition: boolean, msg: string) {
    if (!condition) {
        console.error(`  ✗ FAIL: ${msg}`);
        process.exitCode = 1;
    } else {
        console.log(`  ✓ PASS: ${msg}`);
    }
}

// ────────────────────────────────────────────────────────────
// Test 1: Bicep Parser – VM deployment
// ────────────────────────────────────────────────────────────
console.log('\n═══ Test 1: Bicep Parser – sample-vm-deployment.bicep ═══');
const vmBicep = fs.readFileSync(path.join(EXAMPLES_DIR, 'sample-vm-deployment.bicep'), 'utf-8');
const vmResources = parseBicepContent(vmBicep, 'sample-vm-deployment.bicep');

assert(vmResources.length > 0, `Detected ${vmResources.length} resources (expected > 0)`);

const vmTypes = vmResources.map(r => r.resourceType);
assert(vmTypes.some(t => t.includes('virtualMachines')), 'Found virtualMachines resource');
assert(vmTypes.some(t => t.includes('storageAccounts')), 'Found storageAccounts resource');
assert(vmTypes.some(t => t.includes('virtualNetworks')), 'Found virtualNetworks resource');

const vmResource = vmResources.find(r => r.resourceType.includes('virtualMachines'));
assert(vmResource?.name === 'vmName' || vmResource?.name === 'myProductionVM', `VM name detected: "${vmResource?.name}"`);
assert(vmResource?.location === 'location' || vmResource?.location === 'eastus', `VM location detected: "${vmResource?.location}"`);

// ────────────────────────────────────────────────────────────
// Test 2: Bicep Parser – App Service + SQL
// ────────────────────────────────────────────────────────────
console.log('\n═══ Test 2: Bicep Parser – sample-appservice-sql.bicep ═══');
const appBicep = fs.readFileSync(path.join(EXAMPLES_DIR, 'sample-appservice-sql.bicep'), 'utf-8');
const appResources = parseBicepContent(appBicep, 'sample-appservice-sql.bicep');

assert(appResources.length >= 4, `Detected ${appResources.length} resources (expected >= 4)`);

const appTypes = appResources.map(r => r.resourceType);
assert(appTypes.some(t => t.includes('Web/sites')), 'Found Web/sites resource');
assert(appTypes.some(t => t.includes('Web/serverfarms')), 'Found Web/serverfarms resource');
assert(appTypes.some(t => t.includes('Sql/servers') && !t.includes('databases')), 'Found Sql/servers resource');
assert(appTypes.some(t => t.includes('KeyVault/vaults')), 'Found KeyVault/vaults resource');

// ────────────────────────────────────────────────────────────
// Test 3: Bicep Parser – AKS + Cosmos DB
// ────────────────────────────────────────────────────────────
console.log('\n═══ Test 3: Bicep Parser – sample-aks-cosmos.bicep ═══');
const aksBicep = fs.readFileSync(path.join(EXAMPLES_DIR, 'sample-aks-cosmos.bicep'), 'utf-8');
const aksResources = parseBicepContent(aksBicep, 'sample-aks-cosmos.bicep');

assert(aksResources.length >= 3, `Detected ${aksResources.length} resources (expected >= 3)`);

const aksTypes = aksResources.map(r => r.resourceType);
assert(aksTypes.some(t => t.includes('managedClusters')), 'Found managedClusters resource');
assert(aksTypes.some(t => t.includes('databaseAccounts')), 'Found databaseAccounts resource');

// ────────────────────────────────────────────────────────────
// Test 4: Workload Detector
// ────────────────────────────────────────────────────────────
console.log('\n═══ Test 4: Workload Detector ═══');
const allResources = [...vmResources, ...appResources, ...aksResources];
const analysis = analyzeResources(allResources, [
    'sample-vm-deployment.bicep',
    'sample-appservice-sql.bicep',
    'sample-aks-cosmos.bicep',
]);

assert(analysis.workloads.length > 0, `Detected ${analysis.workloads.length} workload types`);

const workloadTypes = analysis.workloads.map(w => w.type);
assert(workloadTypes.includes('IaaS-VM'), 'Classified IaaS-VM workload');
assert(workloadTypes.includes('AppService'), 'Classified AppService workload');
assert(workloadTypes.includes('SQL'), 'Classified SQL workload');
assert(workloadTypes.includes('AKS'), 'Classified AKS workload');
assert(workloadTypes.includes('Storage'), 'Classified Storage workload');
assert(workloadTypes.includes('KeyVault'), 'Classified KeyVault workload');
assert(workloadTypes.includes('CosmosDB'), 'Classified CosmosDB workload');
assert(workloadTypes.includes('Networking'), 'Classified Networking workload');

assert(analysis.primaryRegion.length > 0, `Primary region: "${analysis.primaryRegion}"`);
assert(analysis.pairedRegion.length > 0, `Paired region: "${analysis.pairedRegion}"`);

// ────────────────────────────────────────────────────────────
// Test 5: ASR Policy Generator
// ────────────────────────────────────────────────────────────
console.log('\n═══ Test 5: ASR Policy Generator ═══');
const asrArtifact = generateAsrPolicy(analysis);
assert(asrArtifact !== undefined, 'ASR policy generated');
assert(asrArtifact!.content.includes('Microsoft.RecoveryServices/vaults'), 'Contains RecoveryServices vault');
assert(asrArtifact!.content.includes('replicationPolicies'), 'Contains replication policy');
assert(asrArtifact!.content.includes('replicationFabrics'), 'Contains replication fabrics');
assert(asrArtifact!.content.includes('replicationProtectionContainerMappings'), 'Contains container mappings');
assert(asrArtifact!.content.includes("instanceType: 'A2A'"), 'Uses A2A instance type');

// ────────────────────────────────────────────────────────────
// Test 6: Backup Policy Generator
// ────────────────────────────────────────────────────────────
console.log('\n═══ Test 6: Backup Policy Generator ═══');
const backupArtifact = generateBackupPolicy(analysis, 30);
assert(backupArtifact.content.includes('Microsoft.RecoveryServices/vaults'), 'Contains backup vault');
assert(backupArtifact.content.includes('backupPolicies'), 'Contains backup policies');
assert(backupArtifact.content.includes('AzureIaasVM'), 'Contains VM backup policy');
assert(backupArtifact.content.includes('AzureWorkload'), 'Contains SQL backup policy');
assert(backupArtifact.content.includes('softDeleteState'), 'Soft delete enabled');
assert(backupArtifact.content.includes('crossRegionRestoreFlag'), 'Cross-region restore configured');

// ────────────────────────────────────────────────────────────
// Test 7: Traffic Manager Generator
// ────────────────────────────────────────────────────────────
console.log('\n═══ Test 7: Traffic Manager Generator ═══');
const tmArtifact = generateTrafficManager(analysis);
assert(tmArtifact.content.includes('Microsoft.Network/trafficManagerProfiles'), 'Contains TM profile');
assert(tmArtifact.content.includes("trafficRoutingMethod: 'Priority'"), 'Uses Priority routing');
assert(tmArtifact.content.includes('monitorConfig'), 'Contains health monitor config');
assert(tmArtifact.content.includes('priority: 1'), 'Primary endpoint has priority 1');
assert(tmArtifact.content.includes('priority: 2'), 'DR endpoint has priority 2');

// ────────────────────────────────────────────────────────────
// Test 8: Paired Region Generator
// ────────────────────────────────────────────────────────────
console.log('\n═══ Test 8: Paired Region Generator ═══');
const prArtifact = generatePairedRegionResources(analysis);
assert(prArtifact.content.includes('Microsoft.Web/serverfarms'), 'Contains DR App Service Plan');
assert(prArtifact.content.includes('Microsoft.Web/sites'), 'Contains DR Web App');
assert(prArtifact.content.includes('failoverGroups'), 'Contains SQL failover group');
assert(prArtifact.content.includes('managedClusters'), 'Contains DR AKS cluster');
assert(prArtifact.content.includes('virtualNetworks'), 'Contains DR VNet');

// ────────────────────────────────────────────────────────────
// Test 9: Failover Runbook Generator
// ────────────────────────────────────────────────────────────
console.log('\n═══ Test 9: Failover Runbook Generator ═══');
const runbookArtifact = generateFailoverRunbook(analysis);
assert(runbookArtifact.relativePath === 'failover-runbook.ps1', 'Correct filename');
assert(runbookArtifact.content.includes('Start-AzRecoveryServicesAsrPlannedFailoverJob'), 'Contains ASR planned failover cmdlet');
assert(runbookArtifact.content.includes('Start-AzRecoveryServicesAsrUnplannedFailoverJob'), 'Contains ASR unplanned failover cmdlet');
assert(runbookArtifact.content.includes('Switch-AzSqlDatabaseFailoverGroup'), 'Contains SQL failover group switch');
assert(runbookArtifact.content.includes('Get-AzTrafficManagerProfile'), 'Contains Traffic Manager cmdlets');
assert(runbookArtifact.content.includes('Get-AzAksCluster'), 'Contains AKS cmdlets');
assert(runbookArtifact.content.includes('Write-Log'), 'Contains logging function');
assert(runbookArtifact.content.includes('FAILOVER SUMMARY'), 'Contains summary section');

// ────────────────────────────────────────────────────────────
// Test 10: DR Test Scheduler Generator
// ────────────────────────────────────────────────────────────
console.log('\n═══ Test 10: DR Test Scheduler Generator ═══');
const testArtifact = generateTestScheduler(analysis, '0 2 1 */3 *');
assert(testArtifact.relativePath === 'dr-test-scheduler.ps1', 'Correct filename');
assert(testArtifact.content.includes('Start-AzRecoveryServicesAsrTestFailoverJob'), 'Contains test failover cmdlet');
assert(testArtifact.content.includes('Start-AzRecoveryServicesAsrTestFailoverCleanupJob'), 'Contains cleanup cmdlet');
assert(testArtifact.content.includes('TestVNetId'), 'Uses isolated test VNet');
assert(testArtifact.content.includes('DR Test Failover Report'), 'Generates Markdown report');
assert(testArtifact.content.includes('0 2 1 */3 *'), 'Contains cron expression');

// ────────────────────────────────────────────────────────────
// Test 11: Compliance Report Generator
// ────────────────────────────────────────────────────────────
console.log('\n═══ Test 11: Compliance Report Generator ═══');
const complianceArtifact = generateComplianceReport(analysis, ['SOC2', 'ISO27001', 'HIPAA'], '0 2 1 */3 *', 30);
assert(complianceArtifact.relativePath === 'dr-compliance-report.md', 'Correct filename');
assert(complianceArtifact.content.includes('SOC 2 Type II'), 'Contains SOC 2 mapping');
assert(complianceArtifact.content.includes('ISO 27001:2022'), 'Contains ISO 27001 mapping');
assert(complianceArtifact.content.includes('HIPAA'), 'Contains HIPAA mapping');
assert(complianceArtifact.content.includes('CC7.4'), 'Contains SOC 2 control references');
assert(complianceArtifact.content.includes('A.5.29'), 'Contains ISO 27001 control references');
assert(complianceArtifact.content.includes('§164.308'), 'Contains HIPAA section references');
assert(complianceArtifact.content.includes('Workload Protection Matrix'), 'Contains protection matrix');
assert(complianceArtifact.content.includes('Failover Procedure'), 'Contains failover procedure');
assert(complianceArtifact.content.includes('Failback Procedure'), 'Contains failback procedure');
assert(complianceArtifact.content.includes('DR Testing Schedule'), 'Contains test schedule');

// ────────────────────────────────────────────────────────────
// Test 12: Networking DR Generator
// ────────────────────────────────────────────────────────────
console.log('\n═══ Test 12: Networking DR Generator ═══');
const netArtifact = generateNetworkingDr(analysis);
assert(netArtifact !== undefined, 'Networking DR artifact generated');
assert(netArtifact!.relativePath === 'networking-dr.bicep', 'Correct filename');
assert(netArtifact!.content.includes('Microsoft.Network/virtualNetworks'), 'Contains DR VNet');
assert(netArtifact!.content.includes('Microsoft.Network/networkSecurityGroups'), 'Contains DR NSG');
assert(netArtifact!.content.includes('param drLocation'), 'Has DR location parameter');
assert(netArtifact!.content.includes('param drVnetAddressPrefix'), 'Has VNet address prefix param');
assert(netArtifact!.content.includes('Generated by Azure DR Blueprint Generator'), 'Has generator header');

// Verify NSG rules are auto-mirrored (not a TODO)
assert(!netArtifact!.content.includes('TODO'), 'No TODO placeholders remain in networking DR');
assert(netArtifact!.content.includes('auto-mirrored'), 'NSG section says auto-mirrored');

// ────────────────────────────────────────────────────────────
// Test 13: Front Door DR Generator
// ────────────────────────────────────────────────────────────
console.log('\n═══ Test 13: Front Door DR Generator ═══');
const fdArtifact = generateFrontDoorDr(analysis);
assert(fdArtifact !== undefined, 'Front Door DR artifact generated');
assert(fdArtifact!.relativePath === 'frontdoor-failover.bicep', 'Correct filename');
assert(fdArtifact!.content.includes('Microsoft.Cdn/profiles'), 'Contains Front Door profile');
assert(fdArtifact!.content.includes('originGroups'), 'Contains origin group');
assert(fdArtifact!.content.includes('priority: 1'), 'Primary origin has priority 1');
assert(fdArtifact!.content.includes('priority: 2'), 'DR origin has priority 2');
assert(fdArtifact!.content.includes('healthProbeSettings'), 'Contains health probe settings');
assert(fdArtifact!.content.includes('FrontDoorWebApplicationFirewallPolicies'), 'Contains WAF policy');
assert(fdArtifact!.content.includes('Microsoft_DefaultRuleSet'), 'WAF has managed rule set');
assert(fdArtifact!.content.includes('securityPolicies'), 'Contains security policy linking WAF');
assert(fdArtifact!.content.includes('routes'), 'Contains route definition');
assert(fdArtifact!.content.includes("httpsRedirect: 'Enabled'"), 'HTTPS redirect enabled');

// ────────────────────────────────────────────────────────────
// Test 14: Compliance Report – New Workload Types
// ────────────────────────────────────────────────────────────
console.log('\n═══ Test 14: Compliance Report – New Workload Types ═══');
assert(complianceArtifact.content.includes('Networking'), 'Report covers Networking workload');
assert(complianceArtifact.content.includes('Mirrored VNet'), 'Report has Networking protection method');
assert(complianceArtifact.content.includes('networking-dr.bicep'), 'Report references networking-dr.bicep artifact');
assert(complianceArtifact.content.includes('frontdoor-failover.bicep'), 'Report references frontdoor-failover.bicep artifact');

// ────────────────────────────────────────────────────────────
// Test 15: Resource Type Coverage
// ────────────────────────────────────────────────────────────
console.log('\n═══ Test 15: Resource Type Mapping Coverage ═══');
const mappedTypes = Object.keys(RESOURCE_TYPE_WORKLOAD_MAP);
assert(mappedTypes.length >= 55, `${mappedTypes.length} resource types mapped (expected >= 55)`);
// Verify critical networking types are mapped
assert(mappedTypes.includes('microsoft.network/virtualnetworks'), 'VNets mapped');
assert(mappedTypes.includes('microsoft.network/networksecuritygroups'), 'NSGs mapped');
assert(mappedTypes.includes('microsoft.network/azurefirewalls'), 'Azure Firewall mapped');
assert(mappedTypes.includes('microsoft.network/virtualwans'), 'Virtual WAN mapped');
assert(mappedTypes.includes('microsoft.network/vpngateways'), 'VPN Gateways mapped');
assert(mappedTypes.includes('microsoft.network/applicationgateways'), 'App Gateways mapped');
assert(mappedTypes.includes('microsoft.network/loadbalancers'), 'Load Balancers mapped');
assert(mappedTypes.includes('microsoft.network/bastionhosts'), 'Bastion Hosts mapped');
assert(mappedTypes.includes('microsoft.network/privateendpoints'), 'Private Endpoints mapped');
assert(mappedTypes.includes('microsoft.network/expressroutecircuits'), 'ExpressRoute mapped');
assert(mappedTypes.includes('microsoft.network/frontdoors'), 'Front Door mapped');
// Verify other new workload types are mapped
assert(mappedTypes.includes('microsoft.app/containerapps'), 'Container Apps mapped');
assert(mappedTypes.includes('microsoft.eventhub/namespaces'), 'Event Hubs mapped');
assert(mappedTypes.includes('microsoft.servicebus/namespaces'), 'Service Bus mapped');
assert(mappedTypes.includes('microsoft.cache/redis'), 'Redis mapped');
assert(mappedTypes.includes('microsoft.insights/components'), 'App Insights mapped');
assert(mappedTypes.includes('microsoft.operationalinsights/workspaces'), 'Log Analytics mapped');
assert(mappedTypes.includes('microsoft.logic/workflows'), 'Logic Apps mapped');

// ────────────────────────────────────────────────────────────
// Test 15: README–Code Consistency
// ────────────────────────────────────────────────────────────
console.log('\n═══ Test 16: README–Code Consistency ═══');
const readmePath = path.resolve(__dirname, '../../README.md');
const readme = fs.readFileSync(readmePath, 'utf-8');
assert(readme.includes('networking-dr.bicep'), 'README lists networking-dr.bicep artifact');
assert(readme.includes('frontdoor-failover.bicep'), 'README lists frontdoor-failover.bicep artifact');
assert(readme.includes('14 types'), 'README mentions 14 workload types in compliance section');
assert(readme.includes('Generate from Live Azure Subscription'), 'README documents Azure export command');
assert(readme.includes('Firewall'), 'README Supported Workloads table includes Firewall');
assert(readme.includes('Messaging'), 'README Supported Workloads table includes Messaging');
assert(readme.includes('Redis'), 'README Supported Workloads table includes Redis');
assert(readme.includes('Monitoring'), 'README Supported Workloads table includes Monitoring');
assert(readme.includes('Container Apps'), 'README Supported Workloads table includes Container Apps');
assert(readme.includes('Azure Functions'), 'README Supported Workloads table includes Azure Functions');
assert(readme.includes('Virtual WAN'), 'README mentions Virtual WAN in Networking');
assert(readme.includes('9 DR artifacts'), 'README says 9 artifacts');
assert(readme.includes('Publishing to the VS Code Marketplace'), 'README has Marketplace publish instructions');
assert(readme.includes('Auto-mirrored security rules'), 'README describes NSG auto-mirror');
assert(readme.includes('WAF policy'), 'README describes Front Door WAF');

// ────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════');
if (process.exitCode === 1) {
    console.log('VALIDATION: SOME TESTS FAILED — see above');
} else {
    console.log('VALIDATION: ALL TESTS PASSED ✓');
}
console.log('═══════════════════════════════════════════\n');
