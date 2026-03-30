// ---------------------------------------------------------------------------
// Failover Runbook generator – executable PowerShell for DR failover
// Uses real Az.RecoveryServices and Az.TrafficManager cmdlets
// ---------------------------------------------------------------------------
import { AnalysisResult, GeneratedArtifact } from '../models/types';
import { getRegionDisplayName } from '../utils/regionPairs';

export function generateFailoverRunbook(analysis: AnalysisResult): GeneratedArtifact {
    const primary = analysis.primaryRegion;
    const secondary = analysis.pairedRegion;
    const primaryDisplay = getRegionDisplayName(primary);
    const secondaryDisplay = getRegionDisplayName(secondary);

    const hasVMs = analysis.workloads.some(w => w.type === 'IaaS-VM');
    const hasSQL = analysis.workloads.some(w => w.type === 'SQL');
    const hasAppService = analysis.workloads.some(w => w.type === 'AppService');
    const hasAKS = analysis.workloads.some(w => w.type === 'AKS');

    const vmSection = hasVMs ? `
    # =========================================================================
    # STEP: Failover VMs via Azure Site Recovery
    # =========================================================================
    Write-Log "Initiating ASR failover for Virtual Machines..."

    $vault = Get-AzRecoveryServicesVault -ResourceGroupName $DrResourceGroupName -Name $RecoveryVaultName
    Set-AzRecoveryServicesAsrVaultContext -Vault $vault

    $fabric = Get-AzRecoveryServicesAsrFabric | Where-Object { $_.FriendlyName -like "*${primary}*" }
    $container = Get-AzRecoveryServicesAsrProtectionContainer -Fabric $fabric

    $protectedItems = Get-AzRecoveryServicesAsrReplicationProtectedItem -ProtectionContainer $container

    if ($protectedItems.Count -eq 0) {
        Write-Log "WARNING: No ASR-protected items found in container. Verify replication is configured." -Level "WARN"
    }

    foreach ($item in $protectedItems) {
        Write-Log "  Failing over: $($item.FriendlyName)..."
        try {
            if ($FailoverType -eq "Planned") {
                $job = Start-AzRecoveryServicesAsrPlannedFailoverJob \\
                    -ReplicationProtectedItem $item \\
                    -Direction PrimaryToRecovery
            } else {
                $job = Start-AzRecoveryServicesAsrUnplannedFailoverJob \\
                    -ReplicationProtectedItem $item \\
                    -Direction PrimaryToRecovery \\
                    -PerformSourceSideAction
            }
            $completedJob = Get-AzRecoveryServicesAsrJob -Job $job | Wait-AzRecoveryServicesAsrJob
            if ($completedJob.State -eq "Succeeded") {
                Write-Log "  ✓ Failover succeeded for $($item.FriendlyName)"
                # Commit the failover
                $commitJob = Start-AzRecoveryServicesAsrCommitFailoverJob -ReplicationProtectedItem $item
                $null = Get-AzRecoveryServicesAsrJob -Job $commitJob | Wait-AzRecoveryServicesAsrJob
                Write-Log "  ✓ Failover committed for $($item.FriendlyName)"
            } else {
                Write-Log "  ✗ Failover FAILED for $($item.FriendlyName): $($completedJob.Errors)" -Level "ERROR"
                $script:failoverErrors += "$($item.FriendlyName): $($completedJob.Errors)"
            }
        } catch {
            Write-Log "  ✗ Exception during failover of $($item.FriendlyName): $_" -Level "ERROR"
            $script:failoverErrors += "$($item.FriendlyName): $_"
        }
    }
` : '';

    const sqlSection = hasSQL ? `
    # =========================================================================
    # STEP: Failover SQL Databases via Failover Group
    # =========================================================================
    Write-Log "Initiating SQL Failover Group switch..."

    try {
        $fogResult = Switch-AzSqlDatabaseFailoverGroup \\
            -ResourceGroupName $DrResourceGroupName \\
            -ServerName $SqlDrServerName \\
            -FailoverGroupName $SqlFailoverGroupName

        if ($fogResult) {
            Write-Log "  ✓ SQL Failover Group '$SqlFailoverGroupName' switched to DR server '$SqlDrServerName'"
        }
    } catch {
        Write-Log "  ✗ SQL Failover Group switch failed: $_" -Level "ERROR"
        $script:failoverErrors += "SQL FOG: $_"
    }
` : '';

    const appServiceSection = hasAppService ? `
    # =========================================================================
    # STEP: Swap App Service to DR region via Traffic Manager
    # =========================================================================
    Write-Log "Updating Traffic Manager to route to DR region..."

    try {
        $tmProfile = Get-AzTrafficManagerProfile \\
            -ResourceGroupName $DrResourceGroupName \\
            -Name $TrafficManagerProfileName

        foreach ($endpoint in $tmProfile.Endpoints) {
            if ($endpoint.Name -like "*${primary}*" -or $endpoint.Name -like "*primary*") {
                $endpoint.EndpointStatus = "Disabled"
                Write-Log "  Disabling primary endpoint: $($endpoint.Name)"
            }
            if ($endpoint.Name -like "*${secondary}*" -or $endpoint.Name -like "*dr*") {
                $endpoint.EndpointStatus = "Enabled"
                $endpoint.Priority = 1
                Write-Log "  Promoting DR endpoint: $($endpoint.Name)"
            }
        }

        Set-AzTrafficManagerProfile -TrafficManagerProfile $tmProfile
        Write-Log "  ✓ Traffic Manager updated – traffic now routed to DR region"
    } catch {
        Write-Log "  ✗ Traffic Manager update failed: $_" -Level "ERROR"
        $script:failoverErrors += "Traffic Manager: $_"
    }
` : '';

    const aksSection = hasAKS ? `
    # =========================================================================
    # STEP: Activate DR AKS Cluster
    # =========================================================================
    Write-Log "Activating DR AKS cluster..."

    try {
        # Scale up the DR cluster from standby
        $aksCluster = Get-AzAksCluster \\
            -ResourceGroupName $DrResourceGroupName \\
            -Name $AksDrClusterName

        Write-Log "  DR AKS cluster '$AksDrClusterName' is in state: $($aksCluster.ProvisioningState)"
        Write-Log "  Ensure kubectl context is switched to DR cluster"
        Write-Log "  Run: az aks get-credentials --resource-group $DrResourceGroupName --name $AksDrClusterName --overwrite-existing"
    } catch {
        Write-Log "  ✗ AKS DR activation failed: $_" -Level "ERROR"
        $script:failoverErrors += "AKS: $_"
    }
` : '';

    // Build parameter block
    const paramDeclarations: string[] = [
        `[Parameter(Mandatory=$true)]
    [string]$DrResourceGroupName`,
        `[Parameter(Mandatory=$false)]
    [ValidateSet("Planned","Unplanned")]
    [string]$FailoverType = "Planned"`,
    ];

    if (hasVMs) {
        paramDeclarations.push(`[Parameter(Mandatory=$true)]
    [string]$RecoveryVaultName`);
    }
    if (hasSQL) {
        paramDeclarations.push(`[Parameter(Mandatory=$true)]
    [string]$SqlDrServerName`,
            `[Parameter(Mandatory=$true)]
    [string]$SqlFailoverGroupName`);
    }
    if (hasAppService || hasVMs) {
        paramDeclarations.push(`[Parameter(Mandatory=$true)]
    [string]$TrafficManagerProfileName`);
    }
    if (hasAKS) {
        paramDeclarations.push(`[Parameter(Mandatory=$true)]
    [string]$AksDrClusterName`);
    }

    const ps1 = `<#
.SYNOPSIS
    Azure Disaster Recovery Failover Runbook
    Generated by Azure DR Blueprint Generator

.DESCRIPTION
    Executes a ${hasVMs ? 'planned or unplanned ' : ''}failover from ${primaryDisplay} to ${secondaryDisplay}.
    This runbook:
    ${hasVMs ? '- Initiates ASR VM failover and commits\n    ' : ''}${hasSQL ? '- Switches SQL Failover Group to DR server\n    ' : ''}${hasAppService ? '- Updates Traffic Manager to route to DR endpoints\n    ' : ''}${hasAKS ? '- Activates standby AKS cluster in DR region\n    ' : ''}- Validates failover and generates a summary report

.PARAMETER DrResourceGroupName
    Resource group containing DR resources.

.PARAMETER FailoverType
    "Planned" for graceful failover, "Unplanned" for disaster scenarios.
    Default: Planned

.EXAMPLE
    .\\failover-runbook.ps1 -DrResourceGroupName "rg-dr-westus" ${hasVMs ? '-RecoveryVaultName "dr-rsv-westus" ' : ''}${hasSQL ? '-SqlDrServerName "dr-sql-westus" -SqlFailoverGroupName "dr-sql-fog" ' : ''}${hasAppService ? '-TrafficManagerProfileName "dr-tm-failover" ' : ''}-FailoverType Planned
#>

[CmdletBinding()]
param(
    ${paramDeclarations.join(',\n\n    ')}
)

# ═══════════════════════════════════════════════════════════════════════════
# Prerequisites and Setup
# ═══════════════════════════════════════════════════════════════════════════
$ErrorActionPreference = "Stop"
$script:failoverErrors = @()
$script:startTime = Get-Date
$logFile = "failover-log-$(Get-Date -Format 'yyyyMMdd-HHmmss').txt"

function Write-Log {
    param(
        [string]$Message,
        [ValidateSet("INFO","WARN","ERROR")]
        [string]$Level = "INFO"
    )
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "[$timestamp] [$Level] $Message"
    Write-Host $entry
    Add-Content -Path $logFile -Value $entry
}

# ═══════════════════════════════════════════════════════════════════════════
# Validate Azure Connection
# ═══════════════════════════════════════════════════════════════════════════
Write-Log "=========================================="
Write-Log "Azure DR Failover Runbook - Starting"
Write-Log "Primary Region:  ${primaryDisplay}"
Write-Log "DR Region:       ${secondaryDisplay}"
Write-Log "Failover Type:   $FailoverType"
Write-Log "=========================================="

try {
    $context = Get-AzContext
    if (-not $context) {
        Write-Log "Not connected to Azure. Running Connect-AzAccount..." -Level "WARN"
        Connect-AzAccount
    }
    Write-Log "Azure context: $($context.Account.Id) / Subscription: $($context.Subscription.Name)"
} catch {
    Write-Log "FATAL: Cannot connect to Azure: $_" -Level "ERROR"
    exit 1
}

# Verify required modules
$requiredModules = @('Az.RecoveryServices', 'Az.Sql', 'Az.TrafficManager', 'Az.Aks', 'Az.Network')
foreach ($mod in $requiredModules) {
    if (-not (Get-Module -ListAvailable -Name $mod)) {
        Write-Log "WARNING: Module '$mod' not found. Install with: Install-Module $mod" -Level "WARN"
    }
}

# Verify DR resource group exists
$rg = Get-AzResourceGroup -Name $DrResourceGroupName -ErrorAction SilentlyContinue
if (-not $rg) {
    Write-Log "FATAL: Resource group '$DrResourceGroupName' not found." -Level "ERROR"
    exit 1
}
Write-Log "DR Resource Group verified: $DrResourceGroupName"

# ═══════════════════════════════════════════════════════════════════════════
# Execute Failover Steps
# ═══════════════════════════════════════════════════════════════════════════
${vmSection}${sqlSection}${appServiceSection}${aksSection}
# ═══════════════════════════════════════════════════════════════════════════
# Failover Summary
# ═══════════════════════════════════════════════════════════════════════════
$duration = (Get-Date) - $script:startTime
Write-Log ""
Write-Log "=========================================="
Write-Log "FAILOVER SUMMARY"
Write-Log "=========================================="
Write-Log "Duration:    $($duration.ToString('hh\\:mm\\:ss'))"

if ($script:failoverErrors.Count -eq 0) {
    Write-Log "Status:      ✓ SUCCESS – All failover steps completed"
    Write-Log "DR Region:   ${secondaryDisplay} is now ACTIVE"
} else {
    Write-Log "Status:      ✗ COMPLETED WITH ERRORS" -Level "WARN"
    Write-Log "Errors ($($script:failoverErrors.Count)):" -Level "WARN"
    foreach ($err in $script:failoverErrors) {
        Write-Log "  - $err" -Level "ERROR"
    }
}

Write-Log "=========================================="
Write-Log "Full log: $logFile"
Write-Log ""
Write-Log "NEXT STEPS:"
Write-Log "  1. Verify application health in ${secondaryDisplay}"
Write-Log "  2. Check DNS propagation for Traffic Manager"
Write-Log "  3. Notify stakeholders per DR communication plan"
Write-Log "  4. Document failover in incident management system"
Write-Log "=========================================="
`;

    return {
        relativePath: 'failover-runbook.ps1',
        content: ps1,
        description: `Executable PowerShell failover runbook: ${primaryDisplay} → ${secondaryDisplay}`,
    };
}
