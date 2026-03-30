// ---------------------------------------------------------------------------
// ARM JSON template parser – extracts resources from ARM/JSON files
// ---------------------------------------------------------------------------
import { DetectedResource } from '../models/types';

interface ArmResource {
    type?: string;
    apiVersion?: string;
    name?: string;
    location?: string;
    properties?: Record<string, unknown>;
    resources?: ArmResource[];
}

interface ArmTemplate {
    $schema?: string;
    contentVersion?: string;
    resources?: ArmResource[];
}

/**
 * Determine whether a JSON object looks like an ARM template.
 * Checks for the $schema containing "deploymentTemplate" or the presence
 * of a top-level `resources` array with typed entries.
 */
export function isArmTemplate(json: unknown): json is ArmTemplate {
    if (typeof json !== 'object' || json === null) { return false; }
    const obj = json as Record<string, unknown>;
    // Standard ARM template schema check
    if (typeof obj.$schema === 'string' &&
        obj.$schema.toLowerCase().includes('deploymenttemplate')) {
        return true;
    }
    // Fallback: has resources array where at least one entry has `type`
    if (Array.isArray(obj.resources) && obj.resources.length > 0) {
        return obj.resources.some(
            (r: unknown) => typeof r === 'object' && r !== null && 'type' in r
        );
    }
    return false;
}

/**
 * Recursively flatten nested ARM resources (child resources).
 */
function flattenResources(resources: ArmResource[], parentType?: string): ArmResource[] {
    const flat: ArmResource[] = [];
    for (const r of resources) {
        const fullType = parentType && r.type && !r.type.includes('/')
            ? `${parentType}/${r.type}`
            : r.type;
        flat.push({ ...r, type: fullType });
        if (r.resources && r.resources.length > 0) {
            flat.push(...flattenResources(r.resources, fullType));
        }
    }
    return flat;
}

/**
 * Simplify ARM expression strings like "[parameters('vmName')]" → "vmName"
 */
function simplifyExpression(expr: unknown): string {
    if (typeof expr !== 'string') { return String(expr ?? ''); }
    // Remove ARM expression brackets
    let s = expr;
    if (s.startsWith('[') && s.endsWith(']')) {
        s = s.slice(1, -1).trim();
    }
    // Extract parameter/variable name
    const paramMatch = s.match(/parameters\(\s*'([^']+)'\s*\)/);
    if (paramMatch) { return paramMatch[1]; }
    const varMatch = s.match(/variables\(\s*'([^']+)'\s*\)/);
    if (varMatch) { return varMatch[1]; }
    return s;
}

/**
 * Parse an ARM template JSON and return detected resources.
 */
export function parseArmContent(content: string, sourceFile: string): DetectedResource[] {
    let json: unknown;
    try {
        json = JSON.parse(content);
    } catch {
        return []; // Not valid JSON
    }

    if (!isArmTemplate(json)) { return []; }

    const template = json as ArmTemplate;
    if (!template.resources) { return []; }

    const allResources = flattenResources(template.resources);
    const detected: DetectedResource[] = [];

    for (const r of allResources) {
        if (!r.type) { continue; }
        detected.push({
            symbolicName: simplifyExpression(r.name),
            resourceType: r.type,
            apiVersion: r.apiVersion ?? '',
            name: simplifyExpression(r.name),
            location: simplifyExpression(r.location),
            sourceFile,
            properties: r.properties ?? {},
        });
    }

    return detected;
}
