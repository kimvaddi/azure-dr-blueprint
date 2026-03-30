// ---------------------------------------------------------------------------
// Networking DR generator – mirrors VNets, NSGs, Route Tables, Firewalls,
// Application Gateways, Front Door, and VPN/ExpressRoute gateways to the
// paired DR region.
// ---------------------------------------------------------------------------
import { AnalysisResult, GeneratedArtifact, ClassifiedWorkload, DetectedResource } from '../models/types';
import { getRegionDisplayName } from '../utils/regionPairs';

/**
 * Extract NSG security rules from detected NSG resources.
 * Works with both ARM JSON exports (where properties.securityRules is an array)
 * and Bicep-parsed resources (where properties are flat key-value).
 * Returns Bicep-formatted rule blocks.
 */
function extractNsgRules(nsgResources: DetectedResource[]): string {
    const allRules: Array<{
        name: string;
        priority: number;
        direction: string;
        access: string;
        protocol: string;
        sourcePortRange: string;
        destinationPortRange: string;
        sourceAddressPrefix: string;
        destinationAddressPrefix: string;
        description?: string;
    }> = [];

    for (const nsg of nsgResources) {
        const props = nsg.properties;
        // ARM JSON export: securityRules is an array of objects
        const rulesRaw = props.securityRules ?? props.SecurityRules;
        if (Array.isArray(rulesRaw)) {
            for (const rule of rulesRaw) {
                if (typeof rule !== 'object' || rule === null) { continue; }
                const r = rule as Record<string, unknown>;
                // ARM format: rule has .name and .properties
                const ruleProps = (typeof r.properties === 'object' && r.properties !== null)
                    ? r.properties as Record<string, unknown>
                    : r;
                const name = String(r.name ?? ruleProps.name ?? 'rule');
                const priority = Number(ruleProps.priority ?? 100);
                const direction = String(ruleProps.direction ?? ruleProps.Direction ?? 'Inbound');
                const access = String(ruleProps.access ?? ruleProps.Access ?? 'Allow');
                const protocol = String(ruleProps.protocol ?? ruleProps.Protocol ?? '*');
                const sourcePortRange = String(ruleProps.sourcePortRange ?? ruleProps.SourcePortRange ?? '*');
                const destinationPortRange = String(ruleProps.destinationPortRange ?? ruleProps.DestinationPortRange ?? '*');
                const sourceAddressPrefix = String(ruleProps.sourceAddressPrefix ?? ruleProps.SourceAddressPrefix ?? '*');
                const destinationAddressPrefix = String(ruleProps.destinationAddressPrefix ?? ruleProps.DestinationAddressPrefix ?? '*');
                const description = ruleProps.description ? String(ruleProps.description) : undefined;

                allRules.push({
                    name, priority, direction, access, protocol,
                    sourcePortRange, destinationPortRange,
                    sourceAddressPrefix, destinationAddressPrefix,
                    description,
                });
            }
        }
    }

    if (allRules.length === 0) {
        return '      // No NSG rules detected in source templates — add your rules here';
    }

    // Deduplicate by name+priority+direction, keeping the first occurrence
    const seen = new Set<string>();
    const uniqueRules = allRules.filter(r => {
        const key = `${r.name}-${r.priority}-${r.direction}`;
        if (seen.has(key)) { return false; }
        seen.add(key);
        return true;
    });

    // Sort by priority
    uniqueRules.sort((a, b) => a.priority - b.priority);

    return uniqueRules.map(r => `      {
        name: '${r.name}'
        properties: {
          priority: ${r.priority}
          direction: '${r.direction}'
          access: '${r.access}'
          protocol: '${r.protocol}'
          sourcePortRange: '${r.sourcePortRange}'
          destinationPortRange: '${r.destinationPortRange}'
          sourceAddressPrefix: '${r.sourceAddressPrefix}'
          destinationAddressPrefix: '${r.destinationAddressPrefix}'${r.description ? `\n          description: '${r.description}'` : ''}
        }
      }`).join('\n');
}

function detectNetworkResources(workload: ClassifiedWorkload): {
    vnets: string[];
    nsgs: string[];
    routeTables: string[];
    appGateways: string[];
    loadBalancers: string[];
    publicIps: string[];
    privateDnsZones: string[];
    privateEndpoints: string[];
    vpnGateways: string[];
    expressRouteCircuits: string[];
    bastionHosts: string[];
    natGateways: string[];
    frontDoors: string[];
    vwans: string[];
    trafficManagers: string[];
} {
    const result = {
        vnets: [] as string[],
        nsgs: [] as string[],
        routeTables: [] as string[],
        appGateways: [] as string[],
        loadBalancers: [] as string[],
        publicIps: [] as string[],
        privateDnsZones: [] as string[],
        privateEndpoints: [] as string[],
        vpnGateways: [] as string[],
        expressRouteCircuits: [] as string[],
        bastionHosts: [] as string[],
        natGateways: [] as string[],
        frontDoors: [] as string[],
        vwans: [] as string[],
        trafficManagers: [] as string[],
    };

    for (const r of workload.resources) {
        const t = r.resourceType.toLowerCase();
        const name = r.name || r.symbolicName;
        if (t.includes('virtualnetworks')) { result.vnets.push(name); }
        else if (t.includes('networksecuritygroups')) { result.nsgs.push(name); }
        else if (t.includes('routetables')) { result.routeTables.push(name); }
        else if (t.includes('applicationgateways')) { result.appGateways.push(name); }
        else if (t.includes('loadbalancers')) { result.loadBalancers.push(name); }
        else if (t.includes('publicipaddresses')) { result.publicIps.push(name); }
        else if (t.includes('privatednszones')) { result.privateDnsZones.push(name); }
        else if (t.includes('privateendpoints')) { result.privateEndpoints.push(name); }
        else if (t.includes('virtualnetworkgateways') || t.includes('vpngateways')) { result.vpnGateways.push(name); }
        else if (t.includes('expressroutecircuits')) { result.expressRouteCircuits.push(name); }
        else if (t.includes('bastionhosts')) { result.bastionHosts.push(name); }
        else if (t.includes('natgateways')) { result.natGateways.push(name); }
        else if (t.includes('frontdoors') || t.includes('cdn/profiles')) { result.frontDoors.push(name); }
        else if (t.includes('virtualwans') || t.includes('virtualhubs')) { result.vwans.push(name); }
        else if (t.includes('trafficmanagerprofiles')) { result.trafficManagers.push(name); }
    }

    return result;
}

export function generateNetworkingDr(analysis: AnalysisResult): GeneratedArtifact | undefined {
    const netWorkload = analysis.workloads.find(w => w.type === 'Networking');
    const fwWorkload = analysis.workloads.find(w => w.type === 'Firewall');

    if (!netWorkload && !fwWorkload) { return undefined; }

    const primary = analysis.primaryRegion;
    const secondary = analysis.pairedRegion;
    const primaryDisplay = getRegionDisplayName(primary);
    const secondaryDisplay = getRegionDisplayName(secondary);

    const net = netWorkload ? detectNetworkResources(netWorkload) : {
        vnets: [], nsgs: [], routeTables: [], appGateways: [], loadBalancers: [],
        publicIps: [], privateDnsZones: [], privateEndpoints: [], vpnGateways: [],
        expressRouteCircuits: [], bastionHosts: [], natGateways: [], frontDoors: [],
        vwans: [], trafficManagers: [],
    };

    const hasFirewall = fwWorkload && fwWorkload.resources.length > 0;
    const firewallNames = hasFirewall
        ? fwWorkload.resources.map(r => r.name || r.symbolicName)
        : [];

    let bicep = `// ---------------------------------------------------------------------------
// DR Networking Infrastructure
// Generated by Azure DR Blueprint Generator
// Primary: ${primaryDisplay} → DR: ${secondaryDisplay}
//
// Detected Networking Resources:
//   VNets: ${net.vnets.length > 0 ? net.vnets.join(', ') : 'none'}
//   NSGs: ${net.nsgs.length > 0 ? net.nsgs.join(', ') : 'none'}
//   Route Tables: ${net.routeTables.length > 0 ? net.routeTables.join(', ') : 'none'}
//   App Gateways: ${net.appGateways.length > 0 ? net.appGateways.join(', ') : 'none'}
//   Load Balancers: ${net.loadBalancers.length > 0 ? net.loadBalancers.join(', ') : 'none'}
//   Firewalls: ${firewallNames.length > 0 ? firewallNames.join(', ') : 'none'}
//   VPN Gateways: ${net.vpnGateways.length > 0 ? net.vpnGateways.join(', ') : 'none'}
//   ExpressRoute: ${net.expressRouteCircuits.length > 0 ? net.expressRouteCircuits.join(', ') : 'none'}
//   Virtual WAN: ${net.vwans.length > 0 ? net.vwans.join(', ') : 'none'}
//   Bastion Hosts: ${net.bastionHosts.length > 0 ? net.bastionHosts.join(', ') : 'none'}
//   Front Door: ${net.frontDoors.length > 0 ? net.frontDoors.join(', ') : 'none'}
// ---------------------------------------------------------------------------

@description('DR region')
param drLocation string = '${secondary}'

@description('Name prefix for DR resources')
param namePrefix string = 'dr'

@description('Address space for DR VNet (must not overlap with primary if connected via VPN/peering)')
param drVnetAddressPrefix string = '10.100.0.0/16'

@description('Default subnet prefix in DR VNet')
param drDefaultSubnetPrefix string = '10.100.1.0/24'
`;

    // VNet
    if (net.vnets.length > 0) {
        bicep += `
// ---------------------------------------------------------------------------
// DR Virtual Network (mirror of: ${net.vnets.join(', ')})
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
          addressPrefix: drDefaultSubnetPrefix
          networkSecurityGroup: {
            id: drNsg.id
          }
        }
      }
    ]
  }
}
`;
    }

    // NSG — extract actual rules from detected NSG resources
    if (net.nsgs.length > 0 || net.vnets.length > 0) {
        // Find NSG resources to extract their security rules
        const nsgResources = netWorkload
            ? netWorkload.resources.filter(r =>
                r.resourceType.toLowerCase().includes('networksecuritygroups') &&
                !r.resourceType.toLowerCase().includes('/'))  // skip child resources
            : [];
        const nsgRulesBicep = extractNsgRules(nsgResources);

        bicep += `
// ---------------------------------------------------------------------------
// DR Network Security Group (auto-mirrored from: ${net.nsgs.length > 0 ? net.nsgs.join(', ') : 'primary NSGs'})
// Rules below are extracted from your source templates/exports
// ---------------------------------------------------------------------------
resource drNsg 'Microsoft.Network/networkSecurityGroups@2023-09-01' = {
  name: '\${namePrefix}-nsg-\${drLocation}'
  location: drLocation
  properties: {
    securityRules: [
${nsgRulesBicep}
    ]
  }
}
`;
    }

    // Route Table
    if (net.routeTables.length > 0) {
        bicep += `
// ---------------------------------------------------------------------------
// DR Route Table (mirror of: ${net.routeTables.join(', ')})
// ---------------------------------------------------------------------------
resource drRouteTable 'Microsoft.Network/routeTables@2023-09-01' = {
  name: '\${namePrefix}-rt-\${drLocation}'
  location: drLocation
  properties: {
    disableBgpRoutePropagation: false
    routes: [
      // TODO: Mirror your primary route table entries here
    ]
  }
}
`;
    }

    // Public IPs
    if (net.publicIps.length > 0 || net.loadBalancers.length > 0 || net.appGateways.length > 0) {
        bicep += `
// ---------------------------------------------------------------------------
// DR Public IP Address
// ---------------------------------------------------------------------------
resource drPublicIp 'Microsoft.Network/publicIPAddresses@2023-09-01' = {
  name: '\${namePrefix}-pip-\${drLocation}'
  location: drLocation
  sku: {
    name: 'Standard'
    tier: 'Regional'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
  }
}
`;
    }

    // Load Balancer
    if (net.loadBalancers.length > 0) {
        bicep += `
// ---------------------------------------------------------------------------
// DR Load Balancer (mirror of: ${net.loadBalancers.join(', ')})
// ---------------------------------------------------------------------------
resource drLoadBalancer 'Microsoft.Network/loadBalancers@2023-09-01' = {
  name: '\${namePrefix}-lb-\${drLocation}'
  location: drLocation
  sku: {
    name: 'Standard'
  }
  properties: {
    frontendIPConfigurations: [
      {
        name: 'frontend'
        properties: {
          publicIPAddress: {
            id: drPublicIp.id
          }
        }
      }
    ]
    backendAddressPools: [
      {
        name: 'backend-pool'
      }
    ]
    probes: [
      {
        name: 'health-probe'
        properties: {
          protocol: 'Tcp'
          port: 443
          intervalInSeconds: 15
          numberOfProbes: 2
        }
      }
    ]
  }
}
`;
    }

    // Application Gateway
    if (net.appGateways.length > 0) {
        bicep += `
// ---------------------------------------------------------------------------
// DR Application Gateway (mirror of: ${net.appGateways.join(', ')})
// Requires a dedicated subnet in the DR VNet
// ---------------------------------------------------------------------------
@description('Subnet prefix for Application Gateway in DR VNet')
param drAppGwSubnetPrefix string = '10.100.2.0/24'

resource drAppGwSubnet 'Microsoft.Network/virtualNetworks/subnets@2023-09-01' = {
  parent: drVnet
  name: 'appgw-subnet'
  properties: {
    addressPrefix: drAppGwSubnetPrefix
  }
}

resource drAppGwPublicIp 'Microsoft.Network/publicIPAddresses@2023-09-01' = {
  name: '\${namePrefix}-appgw-pip-\${drLocation}'
  location: drLocation
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
  }
}

// NOTE: Full Application Gateway config requires backend pools, listeners,
// and routing rules specific to your application. The shell is provided here.
// Export your primary config: az network application-gateway show --name <name> --resource-group <rg>
`;
    }

    // Azure Firewall
    if (hasFirewall) {
        bicep += `
// ---------------------------------------------------------------------------
// DR Azure Firewall (mirror of: ${firewallNames.join(', ')})
// Requires AzureFirewallSubnet in the DR VNet
// ---------------------------------------------------------------------------
@description('Subnet prefix for Azure Firewall in DR VNet')
param drFirewallSubnetPrefix string = '10.100.3.0/26'

resource drFirewallSubnet 'Microsoft.Network/virtualNetworks/subnets@2023-09-01' = {
  parent: drVnet
  name: 'AzureFirewallSubnet'
  properties: {
    addressPrefix: drFirewallSubnetPrefix
  }
}

resource drFirewallPublicIp 'Microsoft.Network/publicIPAddresses@2023-09-01' = {
  name: '\${namePrefix}-fw-pip-\${drLocation}'
  location: drLocation
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
  }
}

resource drFirewall 'Microsoft.Network/azureFirewalls@2023-09-01' = {
  name: '\${namePrefix}-fw-\${drLocation}'
  location: drLocation
  properties: {
    sku: {
      name: 'AZFW_VNet'
      tier: 'Standard'
    }
    threatIntelMode: 'Alert'
    ipConfigurations: [
      {
        name: 'fw-ipconfig'
        properties: {
          subnet: {
            id: drFirewallSubnet.id
          }
          publicIPAddress: {
            id: drFirewallPublicIp.id
          }
        }
      }
    ]
    // IMPORTANT: Attach your Firewall Policy to share rules between primary and DR.
    // If using Azure Firewall Manager, the policy is global and applies to both regions.
    // firewallPolicy: { id: firewallPolicyId }
  }
}
`;
    }

    // NAT Gateway
    if (net.natGateways.length > 0) {
        bicep += `
// ---------------------------------------------------------------------------
// DR NAT Gateway (mirror of: ${net.natGateways.join(', ')})
// ---------------------------------------------------------------------------
resource drNatGatewayPip 'Microsoft.Network/publicIPAddresses@2023-09-01' = {
  name: '\${namePrefix}-natgw-pip-\${drLocation}'
  location: drLocation
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
  }
}

resource drNatGateway 'Microsoft.Network/natGateways@2023-09-01' = {
  name: '\${namePrefix}-natgw-\${drLocation}'
  location: drLocation
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIpAddresses: [
      {
        id: drNatGatewayPip.id
      }
    ]
    idleTimeoutInMinutes: 10
  }
}
`;
    }

    // Bastion Host
    if (net.bastionHosts.length > 0) {
        bicep += `
// ---------------------------------------------------------------------------
// DR Bastion Host (mirror of: ${net.bastionHosts.join(', ')})
// Requires AzureBastionSubnet in the DR VNet
// ---------------------------------------------------------------------------
@description('Subnet prefix for Azure Bastion in DR VNet')
param drBastionSubnetPrefix string = '10.100.4.0/26'

resource drBastionSubnet 'Microsoft.Network/virtualNetworks/subnets@2023-09-01' = {
  parent: drVnet
  name: 'AzureBastionSubnet'
  properties: {
    addressPrefix: drBastionSubnetPrefix
  }
}

resource drBastionPip 'Microsoft.Network/publicIPAddresses@2023-09-01' = {
  name: '\${namePrefix}-bastion-pip-\${drLocation}'
  location: drLocation
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
  }
}

resource drBastionHost 'Microsoft.Network/bastionHosts@2023-09-01' = {
  name: '\${namePrefix}-bastion-\${drLocation}'
  location: drLocation
  sku: {
    name: 'Standard'
  }
  properties: {
    ipConfigurations: [
      {
        name: 'bastion-ipconfig'
        properties: {
          subnet: {
            id: drBastionSubnet.id
          }
          publicIPAddress: {
            id: drBastionPip.id
          }
        }
      }
    ]
  }
}
`;
    }

    // VPN / ExpressRoute guidance
    if (net.vpnGateways.length > 0 || net.expressRouteCircuits.length > 0) {
        bicep += `
// ---------------------------------------------------------------------------
// VPN Gateway / ExpressRoute – DR Guidance
// ${net.vpnGateways.length > 0 ? 'Detected VPN Gateways: ' + net.vpnGateways.join(', ') : ''}
// ${net.expressRouteCircuits.length > 0 ? 'Detected ExpressRoute Circuits: ' + net.expressRouteCircuits.join(', ') : ''}
// ---------------------------------------------------------------------------
//
// VPN/ExpressRoute DR strategy:
//   1. Deploy a VPN Gateway in the DR VNet (requires GatewaySubnet)
//   2. For ExpressRoute: enable ExpressRoute Global Reach or add a second
//      circuit peered to the DR region
//   3. For S2S VPN: configure the DR gateway to your on-premises VPN device
//      as a secondary tunnel
//
// @description('Subnet prefix for Gateway in DR VNet')
// param drGatewaySubnetPrefix string = '10.100.5.0/27'
//
// Uncomment and configure based on your gateway type (VPN or ExpressRoute):
//
// resource drGatewaySubnet 'Microsoft.Network/virtualNetworks/subnets@2023-09-01' = {
//   parent: drVnet
//   name: 'GatewaySubnet'
//   properties: { addressPrefix: drGatewaySubnetPrefix }
// }
`;
    }

    // Virtual WAN guidance
    if (net.vwans.length > 0) {
        bicep += `
// ---------------------------------------------------------------------------
// Virtual WAN – DR Guidance
// Detected: ${net.vwans.join(', ')}
// ---------------------------------------------------------------------------
//
// Azure Virtual WAN is a global resource. For DR:
//   1. Add a Virtual Hub in the DR region to your existing Virtual WAN
//   2. Connect the DR VNet to the new hub
//   3. VPN/ExpressRoute connections in the DR hub will auto-route
//
// Virtual WAN handles cross-region routing natively. You do NOT need
// to duplicate the entire VWAN — just add a hub.
`;
    }

    bicep += `
// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
${net.vnets.length > 0 ? "output drVnetId string = drVnet.id\noutput drVnetName string = drVnet.name" : '// No VNet outputs'}
${hasFirewall ? "output drFirewallPrivateIp string = drFirewall.properties.ipConfigurations[0].properties.privateIPAddress" : ''}
`;

    const totalNetResources = (netWorkload?.resources.length ?? 0) + (fwWorkload?.resources.length ?? 0);

    return {
        relativePath: 'networking-dr.bicep',
        content: bicep,
        description: `DR networking: ${totalNetResources} resource(s) mirrored to ${secondaryDisplay}`,
    };
}
