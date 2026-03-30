// ---------------------------------------------------------------------------
// Backup Policy generator – produces Bicep for Azure Backup vault & policies
// ---------------------------------------------------------------------------
import { AnalysisResult, GeneratedArtifact, WorkloadType } from '../models/types';
import { getRegionDisplayName } from '../utils/regionPairs';
import { API_VERSIONS } from '../utils/constants';

/**
 * Build a VM backup policy schedule block (Bicep).
 */
function vmBackupPolicyBicep(retentionDays: number, apiVer: string): string {
    return `
// ---------------------------------------------------------------------------
// Backup Policy for Virtual Machines – Daily backup, ${retentionDays}-day retention
// ---------------------------------------------------------------------------
resource vmBackupPolicy 'Microsoft.RecoveryServices/vaults/backupPolicies@${apiVer}' = {
  parent: backupVault
  name: '\${namePrefix}-vm-backup-policy'
  properties: {
    backupManagementType: 'AzureIaasVM'
    instantRpRetentionRangeInDays: 5
    schedulePolicy: {
      schedulePolicyType: 'SimpleSchedulePolicy'
      scheduleRunFrequency: 'Daily'
      scheduleRunTimes: [
        '2024-01-01T02:00:00Z'
      ]
    }
    retentionPolicy: {
      retentionPolicyType: 'LongTermRetentionPolicy'
      dailySchedule: {
        retentionTimes: [
          '2024-01-01T02:00:00Z'
        ]
        retentionDuration: {
          count: ${retentionDays}
          durationType: 'Days'
        }
      }
      weeklySchedule: {
        daysOfTheWeek: [
          'Sunday'
        ]
        retentionTimes: [
          '2024-01-01T02:00:00Z'
        ]
        retentionDuration: {
          count: 12
          durationType: 'Weeks'
        }
      }
      monthlySchedule: {
        retentionScheduleFormatType: 'Weekly'
        retentionScheduleWeekly: {
          daysOfTheWeek: [
            'Sunday'
          ]
          weeksOfTheMonth: [
            'First'
          ]
        }
        retentionTimes: [
          '2024-01-01T02:00:00Z'
        ]
        retentionDuration: {
          count: 12
          durationType: 'Months'
        }
      }
      yearlySchedule: {
        retentionScheduleFormatType: 'Weekly'
        monthsOfYear: [
          'January'
        ]
        retentionScheduleWeekly: {
          daysOfTheWeek: [
            'Sunday'
          ]
          weeksOfTheMonth: [
            'First'
          ]
        }
        retentionTimes: [
          '2024-01-01T02:00:00Z'
        ]
        retentionDuration: {
          count: 3
          durationType: 'Years'
        }
      }
    }
    timeZone: 'UTC'
  }
}`;
}

/**
 * Build a SQL backup policy schedule block (Bicep).
 */
function sqlBackupPolicyBicep(retentionDays: number, apiVer: string): string {
    return `
// ---------------------------------------------------------------------------
// Backup Policy for SQL Databases – Full weekly, Diff daily, Log every 15 min
// ---------------------------------------------------------------------------
resource sqlBackupPolicy 'Microsoft.RecoveryServices/vaults/backupPolicies@${apiVer}' = {
  parent: backupVault
  name: '\${namePrefix}-sql-backup-policy'
  properties: {
    backupManagementType: 'AzureWorkload'
    workLoadType: 'SQLDataBase'
    settings: {
      timeZone: 'UTC'
      issqlcompression: true
    }
    subProtectionPolicy: [
      {
        policyType: 'Full'
        schedulePolicy: {
          schedulePolicyType: 'SimpleSchedulePolicy'
          scheduleRunFrequency: 'Weekly'
          scheduleRunDays: [
            'Sunday'
          ]
          scheduleRunTimes: [
            '2024-01-01T02:00:00Z'
          ]
        }
        retentionPolicy: {
          retentionPolicyType: 'LongTermRetentionPolicy'
          weeklySchedule: {
            daysOfTheWeek: [
              'Sunday'
            ]
            retentionTimes: [
              '2024-01-01T02:00:00Z'
            ]
            retentionDuration: {
              count: ${Math.ceil(retentionDays / 7)}
              durationType: 'Weeks'
            }
          }
        }
      }
      {
        policyType: 'Differential'
        schedulePolicy: {
          schedulePolicyType: 'SimpleSchedulePolicy'
          scheduleRunFrequency: 'Weekly'
          scheduleRunDays: [
            'Monday'
            'Tuesday'
            'Wednesday'
            'Thursday'
            'Friday'
            'Saturday'
          ]
          scheduleRunTimes: [
            '2024-01-01T02:00:00Z'
          ]
        }
        retentionPolicy: {
          retentionPolicyType: 'SimpleRetentionPolicy'
          retentionDuration: {
            count: ${retentionDays}
            durationType: 'Days'
          }
        }
      }
      {
        policyType: 'Log'
        schedulePolicy: {
          schedulePolicyType: 'LogSchedulePolicy'
          scheduleFrequencyInMins: 15
        }
        retentionPolicy: {
          retentionPolicyType: 'SimpleRetentionPolicy'
          retentionDuration: {
            count: ${retentionDays}
            durationType: 'Days'
          }
        }
      }
    ]
  }
}`;
}

export function generateBackupPolicy(
    analysis: AnalysisResult,
    retentionDays: number,
): GeneratedArtifact {
    const primary = analysis.primaryRegion;
    const primaryDisplay = getRegionDisplayName(primary);
    const apiVer = API_VERSIONS.backupPolicy;

    const hasVMs = analysis.workloads.some(w => w.type === 'IaaS-VM');
    const hasSQL = analysis.workloads.some(w => w.type === 'SQL');
    const hasAppService = analysis.workloads.some(w => w.type === 'AppService');

    const workloadTypes: WorkloadType[] = analysis.workloads.map(w => w.type);

    let policyBlocks = '';
    if (hasVMs) { policyBlocks += vmBackupPolicyBicep(retentionDays, apiVer); }
    if (hasSQL) { policyBlocks += sqlBackupPolicyBicep(retentionDays, apiVer); }
    if (hasAppService) { policyBlocks += vmBackupPolicyBicep(retentionDays, apiVer).replace(
        /vm-backup-policy/g, 'appservice-backup-policy'
    ).replace(/AzureIaasVM/g, 'AzureIaasVM'); }

    const bicep = `// ---------------------------------------------------------------------------
// Azure Backup – Recovery Services Vault & Backup Policies
// Generated by Azure DR Blueprint Generator
// Region: ${primaryDisplay}
// Workloads: ${workloadTypes.join(', ')}
// ---------------------------------------------------------------------------

@description('Location for the backup vault')
param location string = '${primary}'

@description('Name prefix for backup resources')
param namePrefix string = 'dr'

@description('Enable cross-region restore (uses GRS)')
param enableCrossRegionRestore bool = true

// ---------------------------------------------------------------------------
// Recovery Services Vault for Backup
// ---------------------------------------------------------------------------
resource backupVault 'Microsoft.RecoveryServices/vaults@${apiVer}' = {
  name: '\${namePrefix}-backup-vault'
  location: location
  sku: {
    name: 'RS0'
    tier: 'Standard'
  }
  properties: {
    publicNetworkAccess: 'Enabled'
    securitySettings: {
      softDeleteSettings: {
        softDeleteState: 'Enabled'
        softDeleteRetentionPeriodInDays: 14
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Vault Storage Config – GRS for cross-region restore
// ---------------------------------------------------------------------------
resource vaultStorageConfig 'Microsoft.RecoveryServices/vaults/backupstorageconfig@${apiVer}' = {
  parent: backupVault
  name: 'vaultstorageconfig'
  properties: {
    storageModelType: enableCrossRegionRestore ? 'GeoRedundant' : 'LocallyRedundant'
    crossRegionRestoreFlag: enableCrossRegionRestore
  }
}
${policyBlocks}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
output backupVaultId string = backupVault.id
output backupVaultName string = backupVault.name
`;

    return {
        relativePath: 'backup-vault-policy.bicep',
        content: bicep,
        description: `Backup vault with policies for: ${workloadTypes.join(', ')} (${retentionDays}-day retention)`,
    };
}
