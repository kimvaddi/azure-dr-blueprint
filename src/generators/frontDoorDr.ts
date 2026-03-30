// ---------------------------------------------------------------------------
// Front Door DR generator – produces Bicep for Azure Front Door with
// failover origin groups across primary and DR regions.
// ---------------------------------------------------------------------------
import { AnalysisResult, GeneratedArtifact } from '../models/types';
import { getRegionDisplayName } from '../utils/regionPairs';

export function generateFrontDoorDr(analysis: AnalysisResult): GeneratedArtifact | undefined {
    // Check if Front Door or CDN profiles are detected in networking
    const netWorkload = analysis.workloads.find(w => w.type === 'Networking');
    if (!netWorkload) { return undefined; }

    const frontDoorResources = netWorkload.resources.filter(r => {
        const t = r.resourceType.toLowerCase();
        return t.includes('frontdoors') || t.includes('cdn/profiles');
    });

    // Also generate Front Door if App Service or Container Apps are detected
    // (Front Door is the recommended failover mechanism for web workloads)
    const hasWebWorkloads = analysis.workloads.some(w =>
        w.type === 'AppService' || w.type === 'ContainerApps' || w.type === 'Functions'
    );

    if (frontDoorResources.length === 0 && !hasWebWorkloads) { return undefined; }

    const primary = analysis.primaryRegion;
    const secondary = analysis.pairedRegion;
    const primaryDisplay = getRegionDisplayName(primary);
    const secondaryDisplay = getRegionDisplayName(secondary);

    const existingFrontDoors = frontDoorResources.map(r => r.name || r.symbolicName);

    const hasAppService = analysis.workloads.some(w => w.type === 'AppService');
    const hasContainerApps = analysis.workloads.some(w => w.type === 'ContainerApps');

    // Build origin definitions based on detected workloads
    let originParams = '';
    let originBlocks = '';
    let originGroupRoutes = '';

    if (hasAppService) {
        originParams += `
@description('Hostname of the primary App Service (e.g. myapp.azurewebsites.net)')
param primaryAppServiceHostname string

@description('Hostname of the DR App Service (e.g. myapp-dr.azurewebsites.net)')
param drAppServiceHostname string
`;
        originBlocks += `
  // Primary App Service origin
  resource primaryAppOrigin 'origins' = {
    name: 'primary-appservice'
    properties: {
      hostName: primaryAppServiceHostname
      httpPort: 80
      httpsPort: 443
      priority: 1
      weight: 1000
      enabledState: 'Enabled'
      enforceCertificateNameCheck: true
      originHostHeader: primaryAppServiceHostname
    }
  }

  // DR App Service origin (failover)
  resource drAppOrigin 'origins' = {
    name: 'dr-appservice'
    properties: {
      hostName: drAppServiceHostname
      httpPort: 80
      httpsPort: 443
      priority: 2
      weight: 1000
      enabledState: 'Enabled'
      enforceCertificateNameCheck: true
      originHostHeader: drAppServiceHostname
    }
  }
`;
    }

    if (hasContainerApps) {
        originParams += `
@description('Hostname of the primary Container App (e.g. myapp.blueforest-abc.eastus2.azurecontainerapps.io)')
param primaryContainerAppHostname string

@description('Hostname of the DR Container App')
param drContainerAppHostname string
`;
        originBlocks += `
  // Primary Container App origin
  resource primaryContainerOrigin 'origins' = {
    name: 'primary-containerapp'
    properties: {
      hostName: primaryContainerAppHostname
      httpPort: 80
      httpsPort: 443
      priority: 1
      weight: 1000
      enabledState: 'Enabled'
      enforceCertificateNameCheck: true
      originHostHeader: primaryContainerAppHostname
    }
  }

  // DR Container App origin (failover)
  resource drContainerOrigin 'origins' = {
    name: 'dr-containerapp'
    properties: {
      hostName: drContainerAppHostname
      httpPort: 80
      httpsPort: 443
      priority: 2
      weight: 1000
      enabledState: 'Enabled'
      enforceCertificateNameCheck: true
      originHostHeader: drContainerAppHostname
    }
  }
`;
    }

    // If no specific web workloads, provide generic origin params
    if (!hasAppService && !hasContainerApps) {
        originParams += `
@description('Hostname of the primary backend')
param primaryBackendHostname string

@description('Hostname of the DR backend')
param drBackendHostname string
`;
        originBlocks += `
  // Primary origin
  resource primaryOrigin 'origins' = {
    name: 'primary-origin'
    properties: {
      hostName: primaryBackendHostname
      httpPort: 80
      httpsPort: 443
      priority: 1
      weight: 1000
      enabledState: 'Enabled'
      enforceCertificateNameCheck: true
      originHostHeader: primaryBackendHostname
    }
  }

  // DR origin (failover)
  resource drOrigin 'origins' = {
    name: 'dr-origin'
    properties: {
      hostName: drBackendHostname
      httpPort: 80
      httpsPort: 443
      priority: 2
      weight: 1000
      enabledState: 'Enabled'
      enforceCertificateNameCheck: true
      originHostHeader: drBackendHostname
    }
  }
`;
    }

    const bicep = `// ---------------------------------------------------------------------------
// Azure Front Door – Global Failover with Priority-Based Origin Groups
// Generated by Azure DR Blueprint Generator
// Primary: ${primaryDisplay} → DR: ${secondaryDisplay}
// ${existingFrontDoors.length > 0 ? 'Existing Front Door(s) detected: ' + existingFrontDoors.join(', ') : 'Generated for web workloads requiring global failover'}
// ---------------------------------------------------------------------------

@description('Name prefix for DR resources')
param namePrefix string = 'dr'

@description('Front Door SKU')
@allowed([
  'Standard_AzureFrontDoor'
  'Premium_AzureFrontDoor'
])
param skuName string = 'Standard_AzureFrontDoor'
${originParams}
// ---------------------------------------------------------------------------
// Front Door Profile
// ---------------------------------------------------------------------------
resource frontDoorProfile 'Microsoft.Cdn/profiles@2023-05-01' = {
  name: '\${namePrefix}-fd-failover'
  location: 'global'
  sku: {
    name: skuName
  }
  properties: {
    originResponseTimeoutSeconds: 60
  }
}

// ---------------------------------------------------------------------------
// Front Door Endpoint
// ---------------------------------------------------------------------------
resource frontDoorEndpoint 'Microsoft.Cdn/profiles/afdEndpoints@2023-05-01' = {
  parent: frontDoorProfile
  name: '\${namePrefix}-fd-endpoint'
  location: 'global'
  properties: {
    enabledState: 'Enabled'
  }
}

// ---------------------------------------------------------------------------
// Origin Group – Priority-based failover (primary=1, DR=2)
// Health probes every 30 seconds; failover on 3 consecutive failures
// ---------------------------------------------------------------------------
resource originGroup 'Microsoft.Cdn/profiles/originGroups@2023-05-01' = {
  parent: frontDoorProfile
  name: 'failover-origin-group'
  properties: {
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
      additionalLatencyInMilliseconds: 50
    }
    healthProbeSettings: {
      probePath: '/health'
      probeRequestType: 'HEAD'
      probeProtocol: 'Https'
      probeIntervalInSeconds: 30
    }
    sessionAffinityState: 'Disabled'
  }
${originBlocks}
}

// ---------------------------------------------------------------------------
// Route – sends all traffic through the failover origin group
// ---------------------------------------------------------------------------
resource route 'Microsoft.Cdn/profiles/afdEndpoints/routes@2023-05-01' = {
  parent: frontDoorEndpoint
  name: 'default-route'
  properties: {
    originGroup: {
      id: originGroup.id
    }
    supportedProtocols: [
      'Http'
      'Https'
    ]
    patternsToMatch: [
      '/*'
    ]
    forwardingProtocol: 'HttpsOnly'
    httpsRedirect: 'Enabled'
    linkToDefaultDomain: 'Enabled'
    enabledState: 'Enabled'
  }
}

// ---------------------------------------------------------------------------
// WAF Policy (optional, recommended for production)
// ---------------------------------------------------------------------------
resource wafPolicy 'Microsoft.Network/FrontDoorWebApplicationFirewallPolicies@2022-05-01' = {
  name: '\${namePrefix}-fd-waf'
  location: 'global'
  sku: {
    name: skuName
  }
  properties: {
    policySettings: {
      mode: 'Detection'
      requestBodyCheck: 'Enabled'
      enabledState: 'Enabled'
    }
    managedRules: {
      managedRuleSets: [
        {
          ruleSetType: 'Microsoft_DefaultRuleSet'
          ruleSetVersion: '2.1'
          ruleSetAction: 'Block'
        }
        {
          ruleSetType: 'Microsoft_BotManagerRuleSet'
          ruleSetVersion: '1.0'
        }
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// Security Policy – link WAF to the endpoint
// ---------------------------------------------------------------------------
resource securityPolicy 'Microsoft.Cdn/profiles/securityPolicies@2023-05-01' = {
  parent: frontDoorProfile
  name: '\${namePrefix}-fd-security'
  properties: {
    parameters: {
      type: 'WebApplicationFirewall'
      wafPolicy: {
        id: wafPolicy.id
      }
      associations: [
        {
          domains: [
            {
              id: frontDoorEndpoint.id
            }
          ]
          patternsToMatch: [
            '/*'
          ]
        }
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
output frontDoorEndpointHostname string = frontDoorEndpoint.properties.hostName
output frontDoorProfileId string = frontDoorProfile.id
output wafPolicyId string = wafPolicy.id
`;

    return {
        relativePath: 'frontdoor-failover.bicep',
        content: bicep,
        description: `Front Door failover: ${primaryDisplay} → ${secondaryDisplay} with WAF + health probes`,
    };
}
