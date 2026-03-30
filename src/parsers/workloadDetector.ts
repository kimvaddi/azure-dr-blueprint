// ---------------------------------------------------------------------------
// Workload detector – classifies resources into workload categories and
// determines the primary region + paired DR region.
// ---------------------------------------------------------------------------
import { DetectedResource, ClassifiedWorkload, AnalysisResult, WorkloadType } from '../models/types';
import { RESOURCE_TYPE_WORKLOAD_MAP, DEFAULT_RPO_RTO } from '../utils/constants';
import { getPairedRegion } from '../utils/regionPairs';

/**
 * Classify a single resource into a workload type.
 * Returns undefined if the resource type is not mapped (e.g. networking, NSGs).
 */
export function classifyResource(resource: DetectedResource): WorkloadType | undefined {
    const normType = resource.resourceType.toLowerCase();
    return RESOURCE_TYPE_WORKLOAD_MAP[normType];
}

/**
 * Detect the most common location across all resources.
 * Strips parameter/variable references and normalises to lowercase no-space.
 */
export function detectPrimaryRegion(resources: DetectedResource[]): string {
    const counts: Record<string, number> = {};
    for (const r of resources) {
        if (!r.location) { continue; }
        const loc = r.location.toLowerCase().replace(/[\s-]/g, '');
        // Skip common parameter names that are not actual region values
        if (loc === 'location' || loc === 'resourcegroup().location') {
            continue;
        }
        counts[loc] = (counts[loc] ?? 0) + 1;
    }
    // If all resources use a parameter reference, default to 'eastus'
    const entries = Object.entries(counts);
    if (entries.length === 0) {
        // Check if there's a common parameter reference
        const hasLocationParam = resources.some(r =>
            r.location.toLowerCase() === 'location' ||
            r.location.toLowerCase().includes('resourcegroup')
        );
        return hasLocationParam ? 'eastus' : 'eastus';
    }
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][0];
}

/**
 * Run full analysis: classify resources, group into workloads, detect regions.
 */
export function analyzeResources(
    resources: DetectedResource[],
    sourceFiles: string[],
    rpoOverride?: number,
    rtoOverride?: number,
): AnalysisResult {
    // Group by workload type
    const workloadMap = new Map<WorkloadType, DetectedResource[]>();

    for (const r of resources) {
        const wType = classifyResource(r);
        if (!wType) { continue; }
        if (!workloadMap.has(wType)) { workloadMap.set(wType, []); }
        workloadMap.get(wType)!.push(r);
    }

    const workloads: ClassifiedWorkload[] = [];
    for (const [wType, wResources] of workloadMap.entries()) {
        const defaults = DEFAULT_RPO_RTO[wType];
        workloads.push({
            type: wType,
            resources: wResources,
            recommendedRpoMinutes: rpoOverride ?? defaults.rpo,
            recommendedRtoMinutes: rtoOverride ?? defaults.rto,
        });
    }

    const primaryRegion = detectPrimaryRegion(resources);
    const pairedRegion = getPairedRegion(primaryRegion) ?? 'westus';

    return {
        resources,
        workloads,
        primaryRegion,
        pairedRegion,
        sourceFiles,
        analysedAt: new Date().toISOString(),
    };
}
