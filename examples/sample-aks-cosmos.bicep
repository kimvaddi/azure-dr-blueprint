// ---------------------------------------------------------------------------
// Example: Azure AKS + Cosmos DB Deployment
// Use this file to test the DR Blueprint Generator
// ---------------------------------------------------------------------------

@description('Location for all resources')
param location string = 'eastus2'

@description('AKS cluster name')
param clusterName string = 'aks-production'

@description('Cosmos DB account name')
param cosmosAccountName string = 'cosmos-myapp'

@description('Node count')
param nodeCount int = 3

// AKS Cluster
resource aksCluster 'Microsoft.ContainerService/managedClusters@2024-01-01' = {
  name: clusterName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    dnsPrefix: clusterName
    agentPoolProfiles: [
      {
        name: 'systempool'
        count: nodeCount
        vmSize: 'Standard_D4s_v3'
        osType: 'Linux'
        mode: 'System'
        enableAutoScaling: true
        minCount: 2
        maxCount: 5
      }
    ]
    networkProfile: {
      networkPlugin: 'azure'
      loadBalancerSku: 'standard'
      networkPolicy: 'calico'
    }
    addonProfiles: {
      omsagent: {
        enabled: true
        config: {}
      }
    }
  }
}

// Cosmos DB Account
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-11-15' = {
  name: cosmosAccountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: true
      }
    ]
    enableAutomaticFailover: true
    enableMultipleWriteLocations: false
    backupPolicy: {
      type: 'Periodic'
      periodicModeProperties: {
        backupIntervalInMinutes: 240
        backupRetentionIntervalInHours: 720
        backupStorageRedundancy: 'Geo'
      }
    }
  }
}

// Storage Account for AKS persistent volumes
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-04-01' = {
  name: 'staks${uniqueString(resourceGroup().id)}'
  location: location
  sku: {
    name: 'Standard_GRS'
  }
  kind: 'StorageV2'
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    accessTier: 'Hot'
  }
}

output aksClusterId string = aksCluster.id
output cosmosEndpoint string = cosmosAccount.properties.documentEndpoint
