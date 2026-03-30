// ---------------------------------------------------------------------------
// Constants used across the extension
// ---------------------------------------------------------------------------

/** Resource-type → Workload mapping */
export const RESOURCE_TYPE_WORKLOAD_MAP: Record<string, import('../models/types').WorkloadType> = {
    // Compute
    'microsoft.compute/virtualmachines': 'IaaS-VM',
    'microsoft.compute/virtualmachinescalesets': 'IaaS-VM',
    'microsoft.compute/availabilitysets': 'IaaS-VM',
    'microsoft.compute/disks': 'IaaS-VM',

    // Containers
    'microsoft.containerservice/managedclusters': 'AKS',
    'microsoft.app/containerapps': 'ContainerApps',
    'microsoft.app/managedenvironments': 'ContainerApps',
    'microsoft.containerinstance/containergroups': 'ContainerApps',
    'microsoft.containerregistry/registries': 'ContainerApps',

    // Web / Serverless
    'microsoft.web/sites': 'AppService',
    'microsoft.web/serverfarms': 'AppService',
    'microsoft.web/staticsites': 'AppService',
    'microsoft.web/sites/functions': 'Functions',
    'microsoft.logic/workflows': 'Functions',

    // Databases
    'microsoft.sql/servers': 'SQL',
    'microsoft.sql/servers/databases': 'SQL',
    'microsoft.sql/managedinstances': 'SQL',
    'microsoft.sql/managedinstances/databases': 'SQL',
    'microsoft.dbforpostgresql/flexibleservers': 'SQL',
    'microsoft.dbformysql/flexibleservers': 'SQL',
    'microsoft.documentdb/databaseaccounts': 'CosmosDB',

    // Storage
    'microsoft.storage/storageaccounts': 'Storage',

    // Identity & Secrets
    'microsoft.keyvault/vaults': 'KeyVault',

    // Networking — VNets, Subnets, Gateways, DNS
    'microsoft.network/virtualnetworks': 'Networking',
    'microsoft.network/networksecuritygroups': 'Networking',
    'microsoft.network/routetables': 'Networking',
    'microsoft.network/publicipaddresses': 'Networking',
    'microsoft.network/loadbalancers': 'Networking',
    'microsoft.network/applicationgateways': 'Networking',
    'microsoft.network/natgateways': 'Networking',
    'microsoft.network/privateendpoints': 'Networking',
    'microsoft.network/privatednszones': 'Networking',
    'microsoft.network/virtualnetworkgateways': 'Networking',
    'microsoft.network/connections': 'Networking',
    'microsoft.network/expressroutecircuits': 'Networking',
    'microsoft.network/virtualwans': 'Networking',
    'microsoft.network/virtualhubs': 'Networking',
    'microsoft.network/vpngateways': 'Networking',
    'microsoft.network/bastionhosts': 'Networking',
    'microsoft.network/frontdoors': 'Networking',
    'microsoft.cdn/profiles': 'Networking',
    'microsoft.network/frontdoorwebapplicationfirewallpolicies': 'Networking',
    'microsoft.network/dnszones': 'Networking',
    'microsoft.network/trafficmanagerprofiles': 'Networking',

    // Firewall (separate because it needs specific DR handling)
    'microsoft.network/azurefirewalls': 'Firewall',
    'microsoft.network/firewallpolicies': 'Firewall',

    // Messaging & Events
    'microsoft.eventhub/namespaces': 'Messaging',
    'microsoft.servicebus/namespaces': 'Messaging',
    'microsoft.eventgrid/topics': 'Messaging',
    'microsoft.eventgrid/domains': 'Messaging',
    'microsoft.signalrservice/signalr': 'Messaging',

    // Cache
    'microsoft.cache/redis': 'Redis',
    'microsoft.cache/redisenterprise': 'Redis',

    // Monitoring
    'microsoft.insights/components': 'Monitoring',
    'microsoft.operationalinsights/workspaces': 'Monitoring',
    'microsoft.insights/actiongroups': 'Monitoring',
    'microsoft.alertsmanagement/smartdetectoralertrules': 'Monitoring',
};

/** Default RPO/RTO recommendations per workload (minutes) */
export const DEFAULT_RPO_RTO: Record<import('../models/types').WorkloadType, { rpo: number; rto: number }> = {
    'IaaS-VM':       { rpo: 15,  rto: 60  },
    'AKS':           { rpo: 15,  rto: 60  },
    'AppService':    { rpo: 5,   rto: 30  },
    'SQL':           { rpo: 5,   rto: 30  },
    'Storage':       { rpo: 60,  rto: 120 },
    'KeyVault':      { rpo: 0,   rto: 15  },
    'CosmosDB':      { rpo: 5,   rto: 30  },
    'Networking':    { rpo: 0,   rto: 30  },
    'Firewall':      { rpo: 0,   rto: 30  },
    'ContainerApps': { rpo: 5,   rto: 30  },
    'Functions':     { rpo: 5,   rto: 15  },
    'Messaging':     { rpo: 5,   rto: 30  },
    'Redis':         { rpo: 15,  rto: 30  },
    'Monitoring':    { rpo: 60,  rto: 60  },
};

/** Bicep API versions for DR-related resources (verified current versions) */
export const API_VERSIONS = {
    recoveryServicesVault: '2023-06-01',
    replicationPolicy: '2023-06-01',
    backupPolicy: '2023-06-01',
    trafficManager: '2022-04-01',
    frontDoor: '2023-05-01',
    virtualMachine: '2024-03-01',
    storageAccount: '2023-04-01',
    sqlServer: '2023-05-01-preview',
    appServicePlan: '2023-01-01',
    webApp: '2023-01-01',
    aksCluster: '2024-01-01',
} as const;

export const EXTENSION_ID = 'azure-dr-blueprint';
export const OUTPUT_CHANNEL_NAME = 'Azure DR Blueprint';
