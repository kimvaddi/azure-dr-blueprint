# Azure DR Blueprint Generator

**Automatically generate complete Azure Disaster Recovery blueprints — from Bicep/ARM files on disk *or* directly from a live Azure subscription.**

Every Azure workload needs a DR strategy, but configuring ASR replication, backup policies, failover runbooks, and testing schedules is tedious and error-prone. This extension analyzes your infrastructure and generates a production-ready DR blueprint — not a Word doc.

**No template files? No problem.** The extension connects to your Azure subscription, exports your running infrastructure, and generates the DR blueprint from your live environment.

## What It Does

1. **Analyzes** your infrastructure from **two sources** (you pick):
   - **Local files**: existing `.bicep` and ARM `.json` templates in your workspace
   - **Live Azure**: connects to your subscription, exports resource groups, and analyzes the current state
2. **Auto-detects** workload types: IaaS VMs, AKS, App Service, Azure Functions, Container Apps, SQL Database, Cosmos DB, Storage, Key Vault, Networking (VNets/NSGs/Gateways), Firewall, Messaging (Event Hubs/Service Bus), Redis, and Monitoring
3. **Generates** a complete, matched DR blueprint:

| Artifact | Description |
|----------|-------------|
| `asr-replication-policy.bicep` | Azure Site Recovery vault, replication policy, fabric, and protection container mappings with your RPO/RTO targets |
| `backup-vault-policy.bicep` | Recovery Services backup vault with workload-specific policies (VM daily, SQL full/diff/log) |
| `traffic-manager-failover.bicep` | Traffic Manager profile with priority-based failover routing between primary and DR regions |
| `paired-region-resources.bicep` | DR region infrastructure: App Service Plans, SQL failover groups, standby AKS clusters |
| `networking-dr.bicep` | DR networking: VNets, NSGs, Route Tables, Load Balancers, Firewalls, App Gateways, Bastion, VPN/VWAN guidance |
| `failover-runbook.ps1` | Executable PowerShell script that performs the actual failover using Az modules |
| `dr-test-scheduler.ps1` | Automated isolated test failover with health checks, cleanup, and Markdown report generation |
| `dr-compliance-report.md` | Compliance-ready documentation mapped to SOC 2, ISO 27001, and HIPAA controls |

## Why This Matters

- **SOC 2 Type II** requires documented DR procedures and evidence of testing (CC7.4, CC7.5, A1.2, A1.3)
- **ISO 27001:2022** requires ICT readiness for business continuity (A.5.29, A.5.30, A.8.13, A.8.14)
- **HIPAA Security Rule** requires contingency plans, backup plans, and testing (§164.308)

This extension automates what typically takes a dedicated engineer weeks and ensures your DR configuration doesn't drift from the actual infrastructure.

---

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Press `Ctrl+Shift+X` to open the Extensions panel
3. Search for **"Azure DR Blueprint Generator"**
4. Click **Install**

### From VSIX (Local)

```bash
# Build the extension
npm install
npm run compile
npx @vscode/vsce package

# Install the generated .vsix file
code --install-extension azure-dr-blueprint-1.0.0.vsix
```

---

## Quick Start

You have two paths — choose whichever fits your situation:

### Path A: You have Bicep/ARM template files

### Step 1: Open a workspace with Bicep/ARM templates

Open the folder containing your Azure infrastructure-as-code files:

```
my-project/
├── main.bicep          ← Your existing infrastructure
├── networking.bicep
└── database.bicep
```

### Step 2: Analyze your infrastructure

Open the Command Palette (`Ctrl+Shift+P`) and run:

```
DR Blueprint: Analyze Infrastructure
```

The Output panel shows what was detected:

```
═══════════════════════════════════════════
  Azure DR Blueprint – Infrastructure Analysis
═══════════════════════════════════════════

Primary Region:   East US (eastus)
Paired DR Region: West US (westus)
Files Analysed:   3
Resources Found:  8

Detected Workloads:
  • IaaS-VM: 2 resource(s) — RPO 15min / RTO 60min
      - myProductionVM (Microsoft.Compute/virtualMachines)
      - vmss-web (Microsoft.Compute/virtualMachineScaleSets)
  • SQL: 2 resource(s) — RPO 5min / RTO 30min
      - sql-myapp (Microsoft.Sql/servers)
      - db-myapp (Microsoft.Sql/servers/databases)
  • AppService: 1 resource(s) — RPO 5min / RTO 30min
      - mywebapp (Microsoft.Web/sites)
```

### Step 3: Generate the DR blueprint

Run:

```
DR Blueprint: Generate Full DR Blueprint
```

A `dr-blueprint/` folder is created with all artifacts:

```
my-project/
├── main.bicep
├── dr-blueprint/
│   ├── asr-replication-policy.bicep
│   ├── backup-vault-policy.bicep
│   ├── traffic-manager-failover.bicep
│   ├── paired-region-resources.bicep
│   ├── networking-dr.bicep
│   ├── failover-runbook.ps1
│   ├── dr-test-scheduler.ps1
│   └── dr-compliance-report.md
```

### Step 4: Deploy DR resources

```bash
# Deploy ASR replication policy
az deployment group create \
  --resource-group rg-dr-westus \
  --template-file dr-blueprint/asr-replication-policy.bicep

# Deploy backup vault and policies
az deployment group create \
  --resource-group rg-production \
  --template-file dr-blueprint/backup-vault-policy.bicep

# Deploy Traffic Manager failover routing
az deployment group create \
  --resource-group rg-production \
  --template-file dr-blueprint/traffic-manager-failover.bicep \
  --parameters dnsName=myapp-failover

# Deploy DR region infrastructure
az deployment group create \
  --resource-group rg-dr-westus \
  --template-file dr-blueprint/paired-region-resources.bicep
```

### Step 5: Test DR

```powershell
# Run an isolated test failover (no production impact)
.\dr-blueprint\dr-test-scheduler.ps1 `
    -DrResourceGroupName "rg-dr-westus" `
    -RecoveryVaultName "dr-rsv-westus" `
    -TestVNetId "/subscriptions/<sub-id>/resourceGroups/rg-dr-test/providers/Microsoft.Network/virtualNetworks/vnet-dr-test"
```

---

### Path B: You have a live Azure subscription (no template files)

This is the zero-to-DR path. You don't need any files on disk.

### Step 1: Open any folder in VS Code

It can be empty — the extension will write exported files and generated artifacts into it.

### Step 2: Run any DR Blueprint command

```
Ctrl+Shift+P → DR Blueprint: Generate from Live Azure Subscription
```

Or run `DR Blueprint: Analyze Infrastructure` — if no local template files are found, it **automatically** offers to connect to Azure.

### Step 3: Sign in to Azure

If you're not already authenticated, the extension opens your browser for Azure sign-in via `az login`. If you're already signed in, this step is skipped automatically.

### Step 4: Pick your subscription

A dropdown shows all subscriptions your account has access to. Pick the one with your workload.

### Step 5: Pick your resource groups

A multi-select dropdown lists all resource groups. Pick the ones that make up your workload, or choose "Select All".

### Step 6: Automatic export and analysis

The extension:
1. Runs `az group export` for each selected resource group (captures full configuration)
2. Saves the exported ARM JSON into `.dr-blueprint-exports/` in your workspace
3. Parses the exports and detects workload types
4. Shows the analysis in the Output panel
5. Asks if you want to generate the DR blueprint immediately

```
═══════════════════════════════════════════
  Azure DR Blueprint – Infrastructure Analysis
═══════════════════════════════════════════

Source:           Live Azure export — My Production Sub — [rg-web-prod, rg-data-prod]
Primary Region:   East US 2 (eastus2)
Paired DR Region: Central US (centralus)
Files Analysed:   2
Resources Found:  12

Detected Workloads:
  • IaaS-VM: 3 resource(s) — RPO 15min / RTO 60min
  • SQL: 2 resource(s) — RPO 5min / RTO 30min
  • AppService: 2 resource(s) — RPO 5min / RTO 30min
  • Storage: 2 resource(s) — RPO 60min / RTO 120min
  • KeyVault: 1 resource(s) — RPO 0min / RTO 15min
```

### Step 7: Click "Generate Blueprint"

All 8 DR artifacts are created based on your **live infrastructure's current state** — your actual VMs, databases, web apps, networking, firewalls, regions, and SKUs.

```
your-workspace/
├── .dr-blueprint-exports/       ← exported ARM JSON from Azure
│   ├── rg-web-prod-export.json
│   └── rg-data-prod-export.json
├── dr-blueprint/                ← generated DR artifacts
│   ├── asr-replication-policy.bicep
│   ├── backup-vault-policy.bicep
│   ├── traffic-manager-failover.bicep
│   ├── paired-region-resources.bicep
│   ├── networking-dr.bicep
│   ├── failover-runbook.ps1
│   ├── dr-test-scheduler.ps1
│   └── dr-compliance-report.md
```

---

## How the Dual-Path Flow Works

```
┌─────────────────────────────────────────────────┐
│  User runs any DR Blueprint command              │
└──────────────────────┬──────────────────────────┘
                       │
              ┌────────▼────────┐
              │ Local .bicep or │
              │ .json files     │──── YES ──→ Pick: "Local Files" or "Live Azure"
              │ detected?       │                     │                │
              └────────┬────────┘              ┌──────▼──────┐  ┌─────▼──────┐
                       │                       │ Parse local │  │ Azure flow │
                      NO                       │ files       │  │ (below)    │
                       │                       └──────┬──────┘  └─────┬──────┘
              ┌────────▼──────────────┐               │               │
              │ "No files found.      │         ┌─────▼───────────────▼─────┐
              │  Connect to Azure?"   │         │ Workload detection        │
              └────────┬──────────────┘         │ + DR Blueprint generation │
                       │                        └───────────────────────────┘
              ┌────────▼────────┐
              │ az login        │
              │ → pick sub      │
              │ → pick RGs      │
              │ → az group      │
              │   export        │
              │ → parse exports │
              └────────┬────────┘
                       │
                  Same pipeline
```

---

## Commands

| Command | Description |
|---------|-------------|
| `DR Blueprint: Analyze Infrastructure` | Scan local files or live Azure — auto-detects which path to offer |
| `DR Blueprint: Generate Full DR Blueprint` | Generate all DR artifacts from the last analysis |
| `DR Blueprint: Generate from Live Azure Subscription` | Connect to Azure → export → analyze → generate (direct Azure path) |
| `DR Blueprint: Generate Failover Runbook` | Generate only the PowerShell failover runbook |
| `DR Blueprint: Generate DR Test Schedule` | Generate only the DR test scheduler script |
| `DR Blueprint: Generate Compliance Report` | Generate only the compliance documentation |
| `DR Blueprint: Analyze Current File` | Analyze a single Bicep/ARM file (also in right-click context menu) |

---

## Configuration

Configure via VS Code Settings (`Ctrl+,`) → search for "DR Blueprint":

| Setting | Default | Description |
|---------|---------|-------------|
| `drBlueprint.defaultRpoMinutes` | `15` | Default Recovery Point Objective in minutes |
| `drBlueprint.defaultRtoMinutes` | `60` | Default Recovery Time Objective in minutes |
| `drBlueprint.outputFolder` | `dr-blueprint` | Output folder name for generated artifacts |
| `drBlueprint.complianceFrameworks` | `["SOC2","ISO27001","HIPAA"]` | Compliance frameworks to include in the report |
| `drBlueprint.backupRetentionDays` | `30` | Default backup retention period in days |
| `drBlueprint.testScheduleCron` | `0 2 1 */3 *` | Cron for DR test schedule (default: quarterly at 2 AM) |

---

## Example Walkthrough

This section walks through a complete example using the included sample files.

### Example: VM + Storage Deployment

The file `examples/sample-vm-deployment.bicep` contains a typical IaaS deployment:
- 1 Virtual Machine (Ubuntu, Standard_D4s_v3)
- 1 VNet + NSG + NIC + Public IP
- 1 Storage Account for diagnostics

**Run "Analyze Infrastructure"** against this file. The extension detects:
- **IaaS-VM**: 1 VM → generates ASR replication policy for East US → West US
- **Storage**: 1 account → included in backup policy

**Generated artifacts:**

**`asr-replication-policy.bicep`** creates:
- Recovery Services Vault in West US
- A2A replication policy (RPO: 15 min, hourly app-consistent snapshots, 24-hour retention)
- Replication fabrics for East US and West US
- Protection containers and container mappings

**`backup-vault-policy.bicep`** creates:
- Recovery Services Vault with GRS storage
- VM backup policy: daily at 2 AM UTC, 30-day daily / 12-week weekly / 12-month monthly / 3-year yearly retention
- Soft delete enabled (14-day safety net)
- Cross-region restore enabled

**`failover-runbook.ps1`** provides an executable script that:
- Validates Azure connection and required modules
- Gets the ASR vault and protected items
- Executes planned or unplanned failover for each VM
- Commits the failover
- Updates Traffic Manager routing
- Logs everything to a timestamped file
- Outputs a pass/fail summary

### Example: App Service + SQL Database

`examples/sample-appservice-sql.bicep` contains a web application:
- 1 App Service Plan + Web App (.NET 8 on Linux)
- 1 SQL Server + Database
- 1 Key Vault

The extension detects 3 workload types and generates additional artifacts:
- **SQL Failover Group** in `paired-region-resources.bicep` with automatic failover (60-min grace period)
- **SQL Backup Policy** with full weekly, differential daily, and log backups every 15 minutes
- **Traffic Manager** with priority routing — primary App Service (priority 1), DR App Service (priority 2)

### Example: AKS + Cosmos DB

`examples/sample-aks-cosmos.bicep` demonstrates a container workload:
- 1 AKS cluster (3 nodes, autoscale 2-5)
- 1 Cosmos DB account (session consistency, periodic backup)
- 1 Storage Account (GRS)

The extension detects:
- **AKS** → generates standby cluster definition in Central US (paired with East US 2)
- **CosmosDB** → documented in compliance report (Cosmos DB has built-in multi-region failover)
- **Storage** → included in backup policy

---

## Generated Artifact Details

### ASR Replication Policy (`asr-replication-policy.bicep`)

Deploys Azure Site Recovery infrastructure using `Microsoft.RecoveryServices` resource types:

- **Recovery Services Vault** in the DR region with Standard SKU
- **Replication Policy** with configurable RPO (crash-consistent frequency), app-consistent snapshot frequency (hourly), and recovery point retention (24 hours)
- **Replication Fabrics** for both primary and DR regions
- **Protection Containers** and **Container Mappings** that link primary to DR with the replication policy

After deploying this Bicep, you still need to enable replication for each VM through the Azure portal or CLI:
```bash
az site-recovery protected-item create ...
```

### Backup Vault & Policy (`backup-vault-policy.bicep`)

Deploys a backup infrastructure with workload-specific policies:

- **VM Policy**: Daily backups at 2 AM UTC, 5-day instant restore, 30-day daily retention, 12-week/12-month/3-year long-term retention
- **SQL Policy**: Full backup weekly (Sunday), differential daily (Mon-Sat), log backups every 15 minutes
- **Storage Config**: GRS with cross-region restore enabled
- **Security**: Soft delete enabled with 14-day retention

### Traffic Manager (`traffic-manager-failover.bicep`)

Deploys global DNS-based failover:

- **Priority Routing**: Primary endpoint (priority 1) → DR endpoint (priority 2)
- **Health Monitoring**: HTTPS probes on `/health` every 30 seconds, 3 failures tolerated, 10-second timeout
- **DNS TTL**: 60 seconds for rapid failover propagation
- Endpoint types match detected workloads (Azure endpoints for App Service/VMs, external endpoints for other)

### Paired Region Resources (`paired-region-resources.bicep`)

Pre-provisions infrastructure in the DR region that must exist before failover:

- **VMs**: DR VNet + NSG (VMs themselves are created by ASR during failover)
- **App Service**: DR App Service Plan + Web App (receives same deployments as primary)
- **SQL**: DR SQL Server + Failover Group with automatic failover
- **AKS**: Standby cluster (can be scaled down during normal operation)

### Failover Runbook (`failover-runbook.ps1`)

A production-ready PowerShell script, not a doc template:

- **Prerequisites**: Validates Az modules, Azure connection, resource group
- **VM Failover**: Uses `Start-AzRecoveryServicesAsrPlannedFailoverJob` or `Start-AzRecoveryServicesAsrUnplannedFailoverJob` depending on scenario
- **SQL Failover**: Calls `Switch-AzSqlDatabaseFailoverGroup` to switch read-write to DR
- **Traffic Manager**: Disables primary endpoints, promotes DR endpoints
- **Logging**: Timestamped log file with each step's success/failure
- **Summary**: Final report with duration, status, and next steps

### DR Test Scheduler (`dr-test-scheduler.ps1`)

Automated testing that proves your DR works:

- **Isolated Failover**: Uses `Start-AzRecoveryServicesAsrTestFailoverJob` into a separate VNet
- **No Production Impact**: Test VNet is not connected to production
- **Health Checks**: Verifies test VMs are running, replication health is normal
- **Automatic Cleanup**: `Start-AzRecoveryServicesAsrTestFailoverCleanupJob` removes all test resources
- **Markdown Report**: Complete test report with pass/fail for each check

### Compliance Report (`dr-compliance-report.md`)

Documentation that auditors accept:

- Executive summary with RPO/RTO targets
- Workload protection matrix (which workloads use which protection method)
- Resource inventory (every protected resource with source file)
- DR strategy details per workload type (all 14 types)
- Backup schedule and retention details
- Step-by-step failover and failback procedures
- DR test schedule and procedure
- Compliance control mapping for SOC 2, ISO 27001, and HIPAA

### Networking DR (`networking-dr.bicep`)

Mirrors your complete network topology to the DR region:

- **VNets & Subnets**: DR VNet with address space that doesn't overlap primary (for VPN/peering)
- **NSGs**: Shell with TODO to copy your security rules (export with `az network nsg rule list`)
- **Route Tables**: DR route table placeholder
- **Load Balancers**: Standard SKU LB with health probes
- **Application Gateways**: Dedicated subnet + public IP (backend config is app-specific)
- **Azure Firewall**: DR Firewall in AzureFirewallSubnet, references shared Firewall Policy (rules stay in sync)
- **NAT Gateways**: DR NAT gateway with static public IP
- **Bastion Hosts**: DR Bastion in AzureBastionSubnet for secure VM access
- **VPN/ExpressRoute**: Guidance for deploying gateway in DR region, ExpressRoute Global Reach
- **Virtual WAN**: Guidance for adding a DR hub (VWAN is global — just add a hub, don't duplicate)

---

## Supported Workload Types

| Workload | Resource Types Detected | DR Protection Method |
|----------|------------------------|---------------------|
| **IaaS VM** | `virtualMachines`, `virtualMachineScaleSets`, `availabilitySets`, `disks` | Azure Site Recovery (A2A) |
| **AKS** | `managedClusters` | Standby cluster in paired region |
| **App Service** | `Web/sites`, `Web/serverfarms`, `Web/staticSites` | Multi-region + Traffic Manager |
| **Azure Functions** | `Web/sites/functions`, `Logic/workflows` | Multi-region deployment |
| **Container Apps** | `App/containerApps`, `App/managedEnvironments`, `containerGroups`, `containerRegistries` | Multi-region + Traffic Manager |
| **SQL Database** | `Sql/servers`, `servers/databases`, `managedInstances`, PostgreSQL Flex, MySQL Flex | Auto-failover groups |
| **Cosmos DB** | `DocumentDB/databaseAccounts` | Multi-region automatic failover |
| **Storage** | `storageAccounts` | GRS / RA-GRS |
| **Key Vault** | `KeyVault/vaults` | Built-in geo-replication |
| **Networking** | VNets, NSGs, Route Tables, Load Balancers, App Gateways, NAT Gateways, Public IPs, Private Endpoints, Private DNS, Bastion, Front Door, Virtual WAN, VPN/ExpressRoute Gateways, Traffic Manager | Mirrored topology in DR region |
| **Firewall** | `azureFirewalls`, `firewallPolicies` | DR Firewall with shared policy |
| **Messaging** | Event Hubs, Service Bus, Event Grid, SignalR | Geo-DR namespace pairing |
| **Redis** | `Cache/redis`, `Cache/redisEnterprise` | Geo-replication (active/passive) |
| **Monitoring** | Application Insights, Log Analytics, Action Groups | Multi-region workspaces |

---

## Azure Paired Regions

The extension automatically determines the DR region based on [Azure's official region pairs](https://learn.microsoft.com/en-us/azure/reliability/cross-region-replication-azure):

| Primary | DR Region |
|---------|-----------|
| East US | West US |
| East US 2 | Central US |
| West Europe | North Europe |
| UK South | UK West |
| Australia East | Australia Southeast |
| Japan East | Japan West |
| Southeast Asia | East Asia |
| Canada Central | Canada East |
| And 30+ more pairs... | |

---

## Requirements

- **VS Code** 1.85.0 or later
- **For the local-files path**: `.bicep` or ARM `.json` template files in your workspace
- **For the live-Azure path**: [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) (`az`) installed and on PATH
- For deploying generated resources: Azure CLI (`az`) and Azure PowerShell modules
- Required PowerShell modules for runbooks: `Az.RecoveryServices`, `Az.Sql`, `Az.TrafficManager`, `Az.Aks`, `Az.Network`

---

## Building from Source

```bash
git clone https://github.com/azure-dr-tools/azure-dr-blueprint.git
cd azure-dr-blueprint

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes during development
npm run watch

# Package as VSIX
npx @vscode/vsce package
```

### Running in Development

1. Open this project in VS Code
2. Press `F5` to launch the Extension Development Host
3. In the new VS Code window, open a folder with `.bicep` files (e.g., the `examples/` folder)
4. Run `DR Blueprint: Analyze Infrastructure` from the Command Palette

---

## FAQ

**Q: Does this extension deploy anything to Azure?**
A: No. It only reads your template files (or exports your existing resources as read-only), then generates output files. You deploy the generated Bicep files yourself.

**Q: I don't have Bicep or ARM files — can I still use this?**
A: Yes! Run any command and the extension automatically offers to connect to your Azure subscription. It exports your live resource groups using `az group export`, parses them, and generates the DR blueprint. You don't need to write any IaC first.

**Q: What does the Azure export actually capture?**
A: `az group export` captures the full ARM template representation of every resource in the resource group — types, SKUs, configurations, regions, networking, and dependencies. It's a complete snapshot of your infrastructure's current state.

**Q: What if `az group export` fails for some resources?**
A: Some resource types don't support ARM export. The extension automatically falls back to `az resource list`, which captures resource types and locations. You still get a DR blueprint — it just may have fewer details in the Bicep parameters.

**Q: Where are the exported files stored?**
A: In `.dr-blueprint-exports/` inside your workspace. These are standard ARM JSON templates that you can inspect, version-control, or re-analyze later.

**Q: What if my templates use parameters for region (e.g., `param location string`)?**
A: The extension detects common patterns. If all resources use a parameter reference like `location`, it defaults to `eastus` as the primary region. You can adjust the generated Bicep parameters.

**Q: Can I customize RPO/RTO targets?**
A: Yes. Use VS Code settings `drBlueprint.defaultRpoMinutes` and `drBlueprint.defaultRtoMinutes`, or edit the generated Bicep parameters directly.

**Q: Does the failover runbook actually work?**
A: Yes — it uses real Azure PowerShell cmdlets (`Start-AzRecoveryServicesAsrPlannedFailoverJob`, `Switch-AzSqlDatabaseFailoverGroup`, etc.). You need the Az PowerShell modules installed and an authenticated Azure session.

**Q: How do I schedule the DR test?**
A: Import `dr-test-scheduler.ps1` as an Azure Automation Runbook with a recurring schedule, or use Windows Task Scheduler / Linux cron to run it quarterly.

**Q: Is my Azure credential stored anywhere?**
A: No. The extension uses the existing Azure CLI session (`az login`). It does not store, cache, or transmit credentials. Authentication is handled entirely by the Azure CLI.

---

## License

MIT

---

## Contributing

Contributions are welcome! Please open an issue or PR on the [GitHub repository](https://github.com/azure-dr-tools/azure-dr-blueprint).
