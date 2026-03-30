// ---------------------------------------------------------------------------
// Bicep file parser – extracts resource declarations from .bicep files
// ---------------------------------------------------------------------------
import { DetectedResource } from '../models/types';

/**
 * Regex to match Bicep resource declarations.
 *
 * Pattern captures:
 *   1 – symbolic name (e.g. `vm`)
 *   2 – resource type (e.g. `Microsoft.Compute/virtualMachines`)
 *   3 – API version (e.g. `2024-03-01`)
 *
 * The body is then parsed separately for `name:` and `location:`.
 */
const RESOURCE_DECL_REGEX =
    /resource\s+(\w+)\s+'([^'@]+)@([^']+)'\s*(?:existing)?\s*=\s*\{/g;

/**
 * Find the matching closing brace for a resource block that starts at `openIndex`.
 * `openIndex` should point to the `{` character.
 */
function findMatchingBrace(text: string, openIndex: number): number {
    let depth = 0;
    for (let i = openIndex; i < text.length; i++) {
        if (text[i] === '{') { depth++; }
        if (text[i] === '}') { depth--; }
        if (depth === 0) { return i; }
    }
    return text.length;
}

/**
 * Extract the value assigned to a top-level property inside a Bicep resource body.
 * Handles simple string literals, parameter/variable references, and string interpolation.
 */
function extractProperty(body: string, prop: string): string {
    // Match   prop: <value>   where value may be a quoted string or an identifier
    const regex = new RegExp(`^\\s*${prop}\\s*:\\s*(.+)`, 'm');
    const m = body.match(regex);
    if (!m) { return ''; }
    let value = m[1].trim();
    // Strip trailing comments
    value = value.replace(/\/\/.*$/, '').trim();
    // Remove trailing comma if present
    if (value.endsWith(',')) { value = value.slice(0, -1).trim(); }
    // Remove surrounding quotes for string literals
    if ((value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))) {
        value = value.slice(1, -1);
    }
    return value;
}

/**
 * Extract a nested property block (e.g. `properties: { ... }`) as a flat key-value map.
 * Only goes one level deep to keep things simple and avoids over-engineering.
 */
function extractPropertiesBlock(body: string): Record<string, unknown> {
    const idx = body.indexOf('properties:');
    if (idx === -1) { return {}; }
    // Find the opening brace after 'properties:'
    const braceStart = body.indexOf('{', idx);
    if (braceStart === -1) { return {}; }
    const braceEnd = findMatchingBrace(body, braceStart);
    const inner = body.substring(braceStart + 1, braceEnd);

    const props: Record<string, unknown> = {};
    // Simple extraction of top-level key: value pairs
    const kvRegex = /^\s*(\w+)\s*:\s*(.+)/gm;
    let km;
    while ((km = kvRegex.exec(inner)) !== null) {
        let val: string = km[2].trim();
        if (val.endsWith(',')) { val = val.slice(0, -1).trim(); }
        if ((val.startsWith("'") && val.endsWith("'")) ||
            (val.startsWith('"') && val.endsWith('"'))) {
            val = val.slice(1, -1);
        }
        props[km[1]] = val;
    }
    return props;
}

/**
 * Parse a Bicep file's text content and return all detected resource declarations.
 */
export function parseBicepContent(content: string, sourceFile: string): DetectedResource[] {
    const resources: DetectedResource[] = [];
    let match: RegExpExecArray | null;

    // Reset lastIndex
    RESOURCE_DECL_REGEX.lastIndex = 0;

    while ((match = RESOURCE_DECL_REGEX.exec(content)) !== null) {
        const symbolicName = match[1];
        const resourceType = match[2];
        const apiVersion = match[3];

        // Find the body of this resource block
        const openBrace = content.indexOf('{', match.index + match[0].length - 1);
        const closeBrace = findMatchingBrace(content, openBrace);
        const body = content.substring(openBrace + 1, closeBrace);

        const name = extractProperty(body, 'name');
        const location = extractProperty(body, 'location');
        const properties = extractPropertiesBlock(body);

        resources.push({
            symbolicName,
            resourceType,
            apiVersion,
            name,
            location,
            sourceFile,
            properties,
        });
    }

    return resources;
}
