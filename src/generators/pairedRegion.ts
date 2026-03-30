// ---------------------------------------------------------------------------
// Paired-region resource generator – mirrors detected resources into DR region
// ---------------------------------------------------------------------------
import { AnalysisResult, GeneratedArtifact, ClassifiedWorkload } from '../models/types';
import { getRegionDisplayName } from '../utils/regionPairs';
import { API_VERSIONS } from '../utils/constants';

function generateVmDrResources(workload: ClassifiedWorkload, drRegion: string, apiVer: string): string {
    const vmNames = workload.resources
        .filter(r => r.resourceType.toLowerCase() === 'microsoft.compute/virtualmachines')
        .map(r => r.name || r.symbolicName);

    if (vmNames.length === 0) { return ''; }

    return `
// ---------------------------------------------------------------------------
// DR Region Virtual Network (mirror of primary)
// ---------------------------------------------------------------------------
resource drVnet 'Microsoft.Network/virtualNetworks@2023-09-01' = {
  name: '\${namePrefix}-vnet-\${drLocation}'
  location: drLocation
  properties: {
    addressSpace: {
      addressPrefixes: [
        drVnetAddressPrefix
      ]
    }
    subnets: [
      {
        name: 'default'
        properties: {
          addressPrefix: drSubnetPrefix
        }
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// DR Network Security Group
// ---------------------------------------------------------------------------
resource drNsg 'Microsoft.Network/networkSecurityGroups@2023-09-01' = {
  name: '\${namePrefix}-nsg-\${drLocation}'
  location: drLocation
  properties: {
    securityRules: []
  }
}

// NOTE: VMs in the DR region are created automatically by ASR during failover.
// The network infrastructure above must exist before failover can succeed.
// Detected VMs that will be replicated: ${vmNames.join(', ')}
`;
}

function generateAppServiceDrResources(workload: ClassifiedWorkload, drRegion: string): string {
    const appNames = workload.resources
        .filter(r => r.resourceType.toLowerCase() === 'microsoft.web/sites')
        .map(r => r.name || r.symbolicName);

    return `
// ---------------------------------------------------------------------------
// DR App Service Plan
// ---------------------------------------------------------------------------
resource drAppServicePlan 'Microsoft.Web/serverfarms@${API_VERSIONS.appServicePlan}' = {
  name: '\${namePrefix}-asp-\${drLocation}'
  location: drLocation
  sku: {
    name: drAppServiceSkuName
    tier: drAppServiceSkuTier
  }
  properties: {
    reserved: drAppServiceIsLinux
  }
}

// ---------------------------------------------------------------------------
// DR Web App(s) – mirrors of primary app(s)
// Detected apps: ${appNames.join(', ')}
// ---------------------------------------------------------------------------
resource drWebApp 'Microsoft.Web/sites@${API_VERSIONS.webApp}' = {
  name: '\${namePrefix}-app-\${drLocation}'
  location: drLocation
  properties: {
    serverFarmId: drAppServicePlan.id
    siteConfig: {
      alwaysOn: true
    }
    httpsOnly: true
  }
}
`;
}

function generateSqlDrResources(workload: ClassifiedWorkload, drRegion: string): string {
    return `
// ---------------------------------------------------------------------------
// DR SQL Server (failover group partner)
// ---------------------------------------------------------------------------
resource drSqlServer 'Microsoft.Sql/servers@${API_VERSIONS.sqlServer}' = {
  name: '\${namePrefix}-sql-\${drLocation}'
  location: drLocation
  properties: {
    administratorLogin: sqlAdminLogin
    administratorLoginPassword: sqlAdminPassword
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

// ---------------------------------------------------------------------------
// SQL Failover Group – automatic failover with read-write grace period
// ---------------------------------------------------------------------------
resource sqlFailoverGroup 'Microsoft.Sql/servers/failoverGroups@${API_VERSIONS.sqlServer}' = {
  parent: primarySqlServer
  name: '\${namePrefix}-sql-fog'
  properties: {
    readWriteEndpoint: {
      failoverPolicy: 'Automatic'
      failoverWithDataLossGracePeriodMinutes: 60
    }
    readOnlyEndpoint: {
      failoverPolicy: 'Enabled'
    }
    partnerServers: [
      {
        id: drSqlServer.id
      }
    ]
    databases: sqlDatabaseIds
  }
}
`;
}

function generateAksDrResources(workload: ClassifiedWorkload, drRegion: string): string {
    return `
// ---------------------------------------------------------------------------
// DR AKS Cluster (standby in paired region)
// ---------------------------------------------------------------------------
resource drAksCluster 'Microsoft.ContainerService/managedClusters@${API_VERSIONS.aksCluster}' = {
  name: '\${namePrefix}-aks-\${drLocation}'
  location: drLocation
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    dnsPrefix: '\${namePrefix}-aks-\${drLocation}'
    agentPoolProfiles: [
      {
        name: 'systempool'
        count: drAksNodeCount
        vmSize: drAksNodeVmSize
        osType: 'Linux'
        mode: 'System'
      }
    ]
    networkProfile: {
      networkPlugin: 'azure'
      loadBalancerSku: 'standard'
    }
  }
}
`;
}

export function generatePairedRegionResources(analysis: AnalysisResult): GeneratedArtifact {
    const primary = analysis.primaryRegion;
    const secondary = analysis.pairedRegion;
    const primaryDisplay = getRegionDisplayName(primary);
    const secondaryDisplay = getRegionDisplayName(secondary);

    const hasVMs = analysis.workloads.some(w => w.type === 'IaaS-VM');
    const hasAppService = analysis.workloads.some(w => w.type === 'AppService');
    const hasSQL = analysis.workloads.some(w => w.type === 'SQL');
    const hasAKS = analysis.workloads.some(w => w.type === 'AKS');
    const apiVer = API_VERSIONS.virtualMachine;

    // Build conditional parameter blocks
    const params: string[] = [];
    params.push(`@description('DR region (Azure paired region)')
param drLocation string = '${secondary}'

@description('Name prefix for DR resources')
param namePrefix string = 'dr'`);

    if (hasVMs) {
        params.push(`@description('DR VNet address prefix')
param drVnetAddressPrefix string = '10.1.0.0/16'

@description('DR subnet prefix')
param drSubnetPrefix string = '10.1.0.0/24'`);
    }
    if (hasAppService) {
        params.push(`@description('DR App Service SKU name')
param drAppServiceSkuName string = 'S1'

@description('DR App Service SKU tier')
param drAppServiceSkuTier string = 'Standard'

@description('Whether the DR App Service is Linux')
param drAppServiceIsLinux bool = true`);
    }
    if (hasSQL) {
        params.push(`@description('SQL admin login')
@secure()
param sqlAdminLogin string

@description('SQL admin password')
@secure()
param sqlAdminPassword string

@description('Resource reference to the primary SQL server')
resource primarySqlServer 'Microsoft.Sql/servers@${API_VERSIONS.sqlServer}' existing = {
  name: primarySqlServerName
}

@description('Name of the primary SQL server')
param primarySqlServerName string

@description('Array of database resource IDs to include in the failover group')
param sqlDatabaseIds array`);
    }
    if (hasAKS) {
        params.push(`@description('Node count for DR AKS cluster')
param drAksNodeCount int = 2

@description('VM size for DR AKS nodes')
param drAksNodeVmSize string = 'Standard_DS2_v2'`);
    }

    let resourceBlocks = '';
    for (const w of analysis.workloads) {
        switch (w.type) {
            case 'IaaS-VM':
                resourceBlocks += generateVmDrResources(w, secondary, apiVer);
                break;
            case 'AppService':
                resourceBlocks += generateAppServiceDrResources(w, secondary);
                break;
            case 'SQL':
                resourceBlocks += generateSqlDrResources(w, secondary);
                break;
            case 'AKS':
                resourceBlocks += generateAksDrResources(w, secondary);
                break;
        }
    }

    const bicep = `// ---------------------------------------------------------------------------
// DR Paired-Region Resources
// Generated by Azure DR Blueprint Generator
// Primary: ${primaryDisplay} → DR: ${secondaryDisplay}
// ---------------------------------------------------------------------------

${params.join('\n\n')}
${resourceBlocks}
// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
output drRegion string = drLocation
`;

    return {
        relativePath: 'paired-region-resources.bicep',
        content: bicep,
        description: `Paired-region DR resources in ${secondaryDisplay}`,
    };
}
