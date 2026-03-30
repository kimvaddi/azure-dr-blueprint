// ---------------------------------------------------------------------------
// Core type definitions for Azure DR Blueprint Generator
// ---------------------------------------------------------------------------

/** Supported Azure workload categories */
export type WorkloadType =
    | 'IaaS-VM'
    | 'AKS'
    | 'AppService'
    | 'SQL'
    | 'Storage'
    | 'KeyVault'
    | 'CosmosDB'
    | 'Networking'
    | 'Firewall'
    | 'ContainerApps'
    | 'Functions'
    | 'Messaging'
    | 'Redis'
    | 'Monitoring';

/** A detected Azure resource from Bicep/ARM analysis */
export interface DetectedResource {
    /** Symbolic name in Bicep or resource name */
    symbolicName: string;
    /** Full Azure resource type (e.g. Microsoft.Compute/virtualMachines) */
    resourceType: string;
    /** API version used */
    apiVersion: string;
    /** Resource name expression */
    name: string;
    /** Location/region expression */
    location: string;
    /** Source file path */
    sourceFile: string;
    /** Raw properties (key subset relevant to DR) */
    properties: Record<string, unknown>;
}

/** Classification of a detected resource into a workload type */
export interface ClassifiedWorkload {
    type: WorkloadType;
    resources: DetectedResource[];
    /** Recommended RPO in minutes */
    recommendedRpoMinutes: number;
    /** Recommended RTO in minutes */
    recommendedRtoMinutes: number;
}

/** Result of infrastructure analysis */
export interface AnalysisResult {
    /** All detected resources */
    resources: DetectedResource[];
    /** Classified workloads */
    workloads: ClassifiedWorkload[];
    /** Primary region detected (most common location value) */
    primaryRegion: string;
    /** Paired DR region */
    pairedRegion: string;
    /** Source files analysed */
    sourceFiles: string[];
    /** Timestamp of analysis */
    analysedAt: string;
}

/** Generated DR artifact (a file to write to disk) */
export interface GeneratedArtifact {
    /** Relative path inside the output folder */
    relativePath: string;
    /** File content */
    content: string;
    /** Human-readable description */
    description: string;
}

/** Full DR blueprint output */
export interface DRBlueprint {
    analysis: AnalysisResult;
    artifacts: GeneratedArtifact[];
}

/** Extension configuration (mirrors package.json contributes.configuration) */
export interface ExtensionConfig {
    defaultRpoMinutes: number;
    defaultRtoMinutes: number;
    outputFolder: string;
    complianceFrameworks: string[];
    backupRetentionDays: number;
    testScheduleCron: string;
}
