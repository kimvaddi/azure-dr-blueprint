// ---------------------------------------------------------------------------
// Traffic Manager / Front Door failover routing generator
// ---------------------------------------------------------------------------
import { AnalysisResult, GeneratedArtifact } from '../models/types';
import { getRegionDisplayName } from '../utils/regionPairs';
import { API_VERSIONS } from '../utils/constants';

export function generateTrafficManager(analysis: AnalysisResult): GeneratedArtifact {
    const primary = analysis.primaryRegion;
    const secondary = analysis.pairedRegion;
    const primaryDisplay = getRegionDisplayName(primary);
    const secondaryDisplay = getRegionDisplayName(secondary);
    const tmApiVer = API_VERSIONS.trafficManager;

    const hasWebApps = analysis.workloads.some(w => w.type === 'AppService');
    const hasVMs = analysis.workloads.some(w => w.type === 'IaaS-VM');

    // Build endpoint blocks based on detected workloads
    let endpointBlocks = '';

    if (hasWebApps) {
        endpointBlocks += `
// ---------------------------------------------------------------------------
// Primary App Service Endpoint
// ---------------------------------------------------------------------------
resource primaryWebEndpoint 'Microsoft.Network/trafficManagerProfiles/azureEndpoints@${tmApiVer}' = {
  parent: trafficManagerProfile
  name: 'primary-appservice-\${primaryLocation}'
  properties: {
    targetResourceId: primaryWebAppId
    endpointStatus: 'Enabled'
    priority: 1
    weight: 100
  }
}

// ---------------------------------------------------------------------------
// DR App Service Endpoint (failover target)
// ---------------------------------------------------------------------------
resource drWebEndpoint 'Microsoft.Network/trafficManagerProfiles/azureEndpoints@${tmApiVer}' = {
  parent: trafficManagerProfile
  name: 'dr-appservice-\${drLocation}'
  properties: {
    targetResourceId: drWebAppId
    endpointStatus: 'Enabled'
    priority: 2
    weight: 100
  }
}
`;
    }

    if (hasVMs) {
        endpointBlocks += `
// ---------------------------------------------------------------------------
// Primary VM / Load Balancer Endpoint
// ---------------------------------------------------------------------------
resource primaryVmEndpoint 'Microsoft.Network/trafficManagerProfiles/azureEndpoints@${tmApiVer}' = {
  parent: trafficManagerProfile
  name: 'primary-vm-\${primaryLocation}'
  properties: {
    targetResourceId: primaryPublicIpId
    endpointStatus: 'Enabled'
    priority: 1
    weight: 100
  }
}

// ---------------------------------------------------------------------------
// DR VM / Load Balancer Endpoint (failover target)
// ---------------------------------------------------------------------------
resource drVmEndpoint 'Microsoft.Network/trafficManagerProfiles/azureEndpoints@${tmApiVer}' = {
  parent: trafficManagerProfile
  name: 'dr-vm-\${drLocation}'
  properties: {
    targetResourceId: drPublicIpId
    endpointStatus: 'Enabled'
    priority: 2
    weight: 100
  }
}
`;
    }

    // If no specific workloads detected, provide a generic external endpoint setup
    if (!hasWebApps && !hasVMs) {
        endpointBlocks += `
// ---------------------------------------------------------------------------
// Primary External Endpoint
// ---------------------------------------------------------------------------
resource primaryEndpoint 'Microsoft.Network/trafficManagerProfiles/externalEndpoints@${tmApiVer}' = {
  parent: trafficManagerProfile
  name: 'primary-\${primaryLocation}'
  properties: {
    target: primaryFqdn
    endpointStatus: 'Enabled'
    priority: 1
    weight: 100
    endpointLocation: primaryLocation
  }
}

// ---------------------------------------------------------------------------
// DR External Endpoint (failover target)
// ---------------------------------------------------------------------------
resource drEndpoint 'Microsoft.Network/trafficManagerProfiles/externalEndpoints@${tmApiVer}' = {
  parent: trafficManagerProfile
  name: 'dr-\${drLocation}'
  properties: {
    target: drFqdn
    endpointStatus: 'Enabled'
    priority: 2
    weight: 100
    endpointLocation: drLocation
  }
}
`;
    }

    const paramBlocks: string[] = [];
    if (hasWebApps) {
        paramBlocks.push(`@description('Resource ID of the primary App Service')
param primaryWebAppId string

@description('Resource ID of the DR App Service')
param drWebAppId string`);
    }
    if (hasVMs) {
        paramBlocks.push(`@description('Resource ID of the primary Public IP / Load Balancer')
param primaryPublicIpId string

@description('Resource ID of the DR Public IP / Load Balancer')
param drPublicIpId string`);
    }
    if (!hasWebApps && !hasVMs) {
        paramBlocks.push(`@description('FQDN of the primary endpoint')
param primaryFqdn string

@description('FQDN of the DR endpoint')
param drFqdn string`);
    }

    const bicep = `// ---------------------------------------------------------------------------
// Traffic Manager – Priority-based Failover Routing
// Generated by Azure DR Blueprint Generator
// Primary: ${primaryDisplay} → DR: ${secondaryDisplay}
// ---------------------------------------------------------------------------

@description('Primary region')
param primaryLocation string = '${primary}'

@description('DR region')
param drLocation string = '${secondary}'

@description('Name prefix for resources')
param namePrefix string = 'dr'

@description('DNS name for the Traffic Manager profile (must be globally unique)')
param dnsName string

${paramBlocks.join('\n\n')}

// ---------------------------------------------------------------------------
// Traffic Manager Profile – Priority routing for automatic failover
// ---------------------------------------------------------------------------
resource trafficManagerProfile 'Microsoft.Network/trafficManagerProfiles@${tmApiVer}' = {
  name: '\${namePrefix}-tm-failover'
  location: 'global'
  properties: {
    profileStatus: 'Enabled'
    trafficRoutingMethod: 'Priority'
    dnsConfig: {
      relativeName: dnsName
      ttl: 60
    }
    monitorConfig: {
      protocol: 'HTTPS'
      port: 443
      path: '/health'
      intervalInSeconds: 30
      toleratedNumberOfFailures: 3
      timeoutInSeconds: 10
    }
  }
}
${endpointBlocks}
// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
output trafficManagerFqdn string = trafficManagerProfile.properties.dnsConfig.fqdn
output trafficManagerId string = trafficManagerProfile.id
`;

    return {
        relativePath: 'traffic-manager-failover.bicep',
        content: bicep,
        description: `Traffic Manager priority failover: ${primaryDisplay} → ${secondaryDisplay}`,
    };
}
