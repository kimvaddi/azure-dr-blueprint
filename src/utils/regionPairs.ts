// ---------------------------------------------------------------------------
// Azure region pair mappings (official Microsoft paired regions)
// Source: https://learn.microsoft.com/en-us/azure/reliability/cross-region-replication-azure
// ---------------------------------------------------------------------------

/** Bidirectional Azure region pair map. Key = region name, Value = paired region. */
export const AZURE_REGION_PAIRS: Record<string, string> = {
    // Americas
    'eastus': 'westus',
    'westus': 'eastus',
    'eastus2': 'centralus',
    'centralus': 'eastus2',
    'westus2': 'westcentralus',
    'westcentralus': 'westus2',
    'westus3': 'eastus',
    'northcentralus': 'southcentralus',
    'southcentralus': 'northcentralus',
    'canadacentral': 'canadaeast',
    'canadaeast': 'canadacentral',
    'brazilsouth': 'southcentralus',

    // Europe
    'northeurope': 'westeurope',
    'westeurope': 'northeurope',
    'uksouth': 'ukwest',
    'ukwest': 'uksouth',
    'francecentral': 'francesouth',
    'francesouth': 'francecentral',
    'germanywestcentral': 'germanynorth',
    'germanynorth': 'germanywestcentral',
    'norwayeast': 'norwaywest',
    'norwaywest': 'norwayeast',
    'switzerlandnorth': 'switzerlandwest',
    'switzerlandwest': 'switzerlandnorth',
    'swedencentral': 'swedensouth',
    'swedensouth': 'swedencentral',
    'polandcentral': 'norwayeast',

    // Asia Pacific
    'eastasia': 'southeastasia',
    'southeastasia': 'eastasia',
    'australiaeast': 'australiasoutheast',
    'australiasoutheast': 'australiaeast',
    'australiacentral': 'australiacentral2',
    'australiacentral2': 'australiacentral',
    'japaneast': 'japanwest',
    'japanwest': 'japaneast',
    'koreacentral': 'koreasouth',
    'koreasouth': 'koreacentral',
    'centralindia': 'southindia',
    'southindia': 'centralindia',
    'westindia': 'southindia',
    'jioindiawest': 'jioindiacentral',
    'jioindiacentral': 'jioindiawest',

    // Middle East & Africa
    'southafricanorth': 'southafricawest',
    'southafricawest': 'southafricanorth',
    'uaenorth': 'uaecentral',
    'uaecentral': 'uaenorth',
    'qatarcentral': 'uaenorth',
    'israelcentral': 'italynorth',
    'italynorth': 'israelcentral',
};

/**
 * Display-friendly names for regions.
 */
export const REGION_DISPLAY_NAMES: Record<string, string> = {
    'eastus': 'East US',
    'westus': 'West US',
    'eastus2': 'East US 2',
    'centralus': 'Central US',
    'westus2': 'West US 2',
    'westcentralus': 'West Central US',
    'westus3': 'West US 3',
    'northcentralus': 'North Central US',
    'southcentralus': 'South Central US',
    'canadacentral': 'Canada Central',
    'canadaeast': 'Canada East',
    'brazilsouth': 'Brazil South',
    'northeurope': 'North Europe',
    'westeurope': 'West Europe',
    'uksouth': 'UK South',
    'ukwest': 'UK West',
    'francecentral': 'France Central',
    'francesouth': 'France South',
    'germanywestcentral': 'Germany West Central',
    'germanynorth': 'Germany North',
    'norwayeast': 'Norway East',
    'norwaywest': 'Norway West',
    'switzerlandnorth': 'Switzerland North',
    'switzerlandwest': 'Switzerland West',
    'swedencentral': 'Sweden Central',
    'swedensouth': 'Sweden South',
    'polandcentral': 'Poland Central',
    'eastasia': 'East Asia',
    'southeastasia': 'Southeast Asia',
    'australiaeast': 'Australia East',
    'australiasoutheast': 'Australia Southeast',
    'australiacentral': 'Australia Central',
    'australiacentral2': 'Australia Central 2',
    'japaneast': 'Japan East',
    'japanwest': 'Japan West',
    'koreacentral': 'Korea Central',
    'koreasouth': 'Korea South',
    'centralindia': 'Central India',
    'southindia': 'South India',
    'westindia': 'West India',
    'southafricanorth': 'South Africa North',
    'southafricawest': 'South Africa West',
    'uaenorth': 'UAE North',
    'uaecentral': 'UAE Central',
    'qatarcentral': 'Qatar Central',
    'israelcentral': 'Israel Central',
    'italynorth': 'Italy North',
};

/**
 * Get paired region for a given Azure region.
 * Normalises the input to lowercase and strips spaces.
 */
export function getPairedRegion(region: string): string | undefined {
    const normalised = region.toLowerCase().replace(/[\s-]/g, '');
    return AZURE_REGION_PAIRS[normalised];
}

/**
 * Get display name for a region, or return the raw value if not found.
 */
export function getRegionDisplayName(region: string): string {
    const normalised = region.toLowerCase().replace(/[\s-]/g, '');
    return REGION_DISPLAY_NAMES[normalised] ?? region;
}
