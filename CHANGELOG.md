# Changelog

## [1.0.0] - 2026-03-30

### Added
- Initial release of Azure DR Blueprint Generator
- **Dual-path infrastructure source**: local Bicep/ARM files OR live Azure subscription export
- Live Azure flow: `az login` → pick subscription → pick resource groups → `az group export` → analyze
- Bicep file parser for detecting Azure resource declarations
- ARM JSON template parser with support for nested resources
- **14 workload types detected**:
  - Compute: IaaS VMs (VMs, VMSS, Availability Sets, Disks)
  - Containers: AKS, Container Apps, Container Instances, Container Registry
  - Web/Serverless: App Service, Azure Functions, Logic Apps
  - Databases: SQL Server/DB/MI, PostgreSQL Flex, MySQL Flex, Cosmos DB
  - Storage: Storage Accounts (GRS/RA-GRS)
  - Identity: Key Vault
  - Networking: VNets, NSGs, Route Tables, Load Balancers, App Gateways, NAT Gateways, Public IPs, Private Endpoints, Private DNS Zones, Bastion, Front Door, CDN, Virtual WAN/Hubs, VPN Gateways, ExpressRoute, Traffic Manager, DNS Zones
  - Security: Azure Firewall, Firewall Policies
  - Messaging: Event Hubs, Service Bus, Event Grid, SignalR
  - Cache: Azure Cache for Redis, Redis Enterprise
  - Monitoring: Application Insights, Log Analytics, Action Groups
- Automatic Azure paired-region detection (50+ regions supported)
- ASR replication policy generator (Bicep) with configurable RPO/RTO
- Azure Backup vault and policy generator (VM daily, SQL full/diff/log)
- Traffic Manager failover routing generator (priority-based)
- Paired-region resource generator (App Service, SQL failover groups, AKS)
- **Networking DR generator**: VNets, NSGs, LBs, App Gateways, Azure Firewall, Bastion, NAT Gateways, VPN/ER/VWAN guidance
- Executable PowerShell failover runbook with Az module cmdlets
- DR test scheduler with isolated test failover and automatic cleanup
- Compliance report generator mapped to SOC 2, ISO 27001, and HIPAA controls (all 14 workload types)
- 8 VS Code commands including direct Azure path (`Generate from Live Azure Subscription`)
- Configurable settings: RPO/RTO targets, retention days, compliance frameworks, cron schedule
- Right-click context menu support for .bicep and .json files
- Example Bicep files (VM, App Service + SQL, AKS + Cosmos DB)
- 57 Azure resource types mapped across 14 workload categories
