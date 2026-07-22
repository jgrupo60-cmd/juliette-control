[CmdletBinding()]
param(
    [string]$FunctionAppName = "juliette-control-api",
    [string]$FunctionResourceGroup = "JULIETTE-CONTROL",
    [string]$SubscriptionNameOrId = "Azure for Students",
    [string]$GitHubOrigin = "https://jgrupo60-cmd.github.io"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step {
    param([int]$Number, [int]$Total, [string]$Message)
    Write-Host ("[{0}/{1}] {2}" -f $Number, $Total, $Message) -ForegroundColor Cyan
}

function Require-Command {
    param([Parameter(Mandatory = $true)][string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found in PATH. Close and reopen PowerShell after installing it."
    }
}

function Invoke-AzText {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$FailureMessage = "Azure CLI command failed.",
        [switch]$AllowEmpty
    )

    $output = & az @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    $text = (($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine).Trim()

    if ($exitCode -ne 0) {
        if (-not $text) { $text = "az exited with code $exitCode" }
        throw "$FailureMessage`n$text"
    }

    if ((-not $AllowEmpty) -and [string]::IsNullOrWhiteSpace($text)) {
        throw "$FailureMessage Azure CLI returned an empty response."
    }

    return $text
}

function Invoke-AzJson {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$FailureMessage = "Azure CLI command failed."
    )

    $text = Invoke-AzText -Arguments $Arguments -FailureMessage $FailureMessage
    try {
        return $text | ConvertFrom-Json
    }
    catch {
        throw "$FailureMessage Azure CLI did not return valid JSON.`n$text"
    }
}

function Ensure-AzureLogin {
    & az account show --only-show-errors --output none 1>$null 2>$null
    if ($LASTEXITCODE -eq 0) { return }

    Write-Host "No active Azure CLI session was found. Opening sign-in..." -ForegroundColor Yellow
    & az login --only-show-errors | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Azure sign-in failed. Run 'az login' manually and try again."
    }
}

function Resolve-FunctionHostName {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$ResourceGroup,
        [Parameter(Mandatory = $true)][string]$SubscriptionId
    )

    $common = @(
        "--name", $Name,
        "--resource-group", $ResourceGroup,
        "--subscription", $SubscriptionId,
        "--only-show-errors",
        "--output", "tsv"
    )

    # Azure CLI/Flex Consumption can expose the hostname at different JSON paths.
    $queries = @("defaultHostName", "properties.defaultHostName")
    foreach ($query in $queries) {
        $candidate = Invoke-AzText -Arguments (@("functionapp", "show") + $common + @("--query", $query)) `
            -FailureMessage "Could not inspect Function App '$Name'." -AllowEmpty
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and $candidate -ne "null") {
            return $candidate.Trim()
        }
    }

    # Final authoritative fallback: inspect the hostname bindings exposed by App Service.
    $candidate = Invoke-AzText -Arguments @(
        "functionapp", "config", "hostname", "list",
        "--name", $Name,
        "--resource-group", $ResourceGroup,
        "--subscription", $SubscriptionId,
        "--query", "[?contains(name, '.azurewebsites.net')].name | [0]",
        "--only-show-errors",
        "--output", "tsv"
    ) -FailureMessage "Could not read hostname bindings for Function App '$Name'." -AllowEmpty

    if (-not [string]::IsNullOrWhiteSpace($candidate) -and $candidate -ne "null") {
        return $candidate.Trim()
    }

    throw "Azure found Function App '$Name', but no default HTTPS hostname could be resolved. Open its Overview page and verify that a default domain exists."
}

Require-Command "az"
Require-Command "func"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ApiPath = Join-Path $RepoRoot "api"
$ConfigPath = Join-Path $RepoRoot "config\app.js"

if (-not (Test-Path $ApiPath -PathType Container)) {
    throw "API folder not found: $ApiPath"
}
if (-not (Test-Path (Join-Path $ApiPath "function_app.py") -PathType Leaf)) {
    throw "function_app.py was not found inside: $ApiPath"
}
if (-not (Test-Path $ConfigPath -PathType Leaf)) {
    throw "Frontend config file not found: $ConfigPath"
}

$TotalSteps = 7

Write-Step 1 $TotalSteps "Checking Azure CLI session"
Ensure-AzureLogin

Write-Step 2 $TotalSteps "Selecting Azure subscription"
& az account set --subscription $SubscriptionNameOrId --only-show-errors
if ($LASTEXITCODE -ne 0) {
    throw "Could not select subscription '$SubscriptionNameOrId'."
}

$account = Invoke-AzJson -Arguments @("account", "show", "--only-show-errors", "--output", "json") `
    -FailureMessage "Could not read the active Azure subscription."
$accountName = [string]($account.PSObject.Properties["name"].Value)
$accountId = [string]($account.PSObject.Properties["id"].Value)
if ([string]::IsNullOrWhiteSpace($accountId)) {
    throw "The active Azure subscription did not include an id."
}
Write-Host ("Active subscription: {0} ({1})" -f $accountName, $accountId) -ForegroundColor DarkGray

Write-Step 3 $TotalSteps "Checking Function App"
# Existence check only. Hostname is resolved separately to support Flex Consumption payload differences.
& az functionapp show `
    --name $FunctionAppName `
    --resource-group $FunctionResourceGroup `
    --subscription $accountId `
    --only-show-errors `
    --output none
if ($LASTEXITCODE -ne 0) {
    throw "Function App '$FunctionAppName' was not found in resource group '$FunctionResourceGroup'."
}

$hostName = Resolve-FunctionHostName -Name $FunctionAppName -ResourceGroup $FunctionResourceGroup -SubscriptionId $accountId
Write-Host ("Function App: {0} | Host: {1}" -f $FunctionAppName, $hostName) -ForegroundColor DarkGray

Write-Step 4 $TotalSteps "Validating required application settings"
$settings = Invoke-AzJson -Arguments @(
    "functionapp", "config", "appsettings", "list",
    "--name", $FunctionAppName,
    "--resource-group", $FunctionResourceGroup,
    "--subscription", $accountId,
    "--only-show-errors",
    "--output", "json"
) -FailureMessage "Could not read Function App settings."

$settingNames = @($settings | ForEach-Object {
    if ($_.PSObject.Properties["name"]) { [string]$_.PSObject.Properties["name"].Value }
})
$requiredSettings = @(
    "AZURE_SUBSCRIPTION_ID",
    "AZURE_RESOURCE_GROUP",
    "AZURE_VM_NAME",
    "AZURE_VM_RESOURCE_ID",
    "ALLOWED_ORIGINS",
    "CONTROL_ACCESS_TOKEN"
)
$missingSettings = @($requiredSettings | Where-Object { $_ -notin $settingNames })
if ($missingSettings.Count -gt 0) {
    throw "Missing Function App settings: $($missingSettings -join ', '). Add them in Azure Portal and run the script again."
}
Write-Host "Required settings are present." -ForegroundColor DarkGray

Write-Step 5 $TotalSteps "Configuring CORS for GitHub Pages"
$cors = Invoke-AzJson -Arguments @(
    "functionapp", "cors", "show",
    "--name", $FunctionAppName,
    "--resource-group", $FunctionResourceGroup,
    "--subscription", $accountId,
    "--only-show-errors",
    "--output", "json"
) -FailureMessage "Could not read the current CORS configuration."

$allowedOrigins = @()
if ($cors.PSObject.Properties["allowedOrigins"]) {
    $allowedOrigins = @($cors.PSObject.Properties["allowedOrigins"].Value)
}
if ($GitHubOrigin -notin $allowedOrigins) {
    & az functionapp cors add `
        --name $FunctionAppName `
        --resource-group $FunctionResourceGroup `
        --subscription $accountId `
        --allowed-origins $GitHubOrigin `
        --only-show-errors
    if ($LASTEXITCODE -ne 0) {
        throw "Could not add '$GitHubOrigin' to Function App CORS."
    }
    Write-Host "CORS origin added." -ForegroundColor DarkGray
}
else {
    Write-Host "CORS origin was already configured." -ForegroundColor DarkGray
}

Write-Step 6 $TotalSteps "Publishing Azure Function with remote build"
Push-Location $ApiPath
try {
    & func azure functionapp publish $FunctionAppName --python --build remote
    if ($LASTEXITCODE -ne 0) {
        throw "Azure Functions Core Tools publish failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

Write-Step 7 $TotalSteps "Connecting frontend to the deployed API"
$hostName = Resolve-FunctionHostName -Name $FunctionAppName -ResourceGroup $FunctionResourceGroup -SubscriptionId $accountId
$ApiBaseUrl = "https://$hostName"
$config = Get-Content $ConfigPath -Raw
$pattern = "apiBaseUrl:\s*'[^']*'"
if (-not [regex]::IsMatch($config, $pattern)) {
    throw "Could not find apiBaseUrl in config/app.js. The frontend file was not modified."
}
$config = [regex]::Replace($config, $pattern, "apiBaseUrl: '$ApiBaseUrl'", 1)
Set-Content -Path $ConfigPath -Value $config -Encoding UTF8

Write-Host ""
Write-Host "PR-004 deployment completed successfully." -ForegroundColor Green
Write-Host "Health endpoint: $ApiBaseUrl/api/health"
Write-Host "VM status endpoint: $ApiBaseUrl/api/vm/status"
Write-Host ""
Write-Host "Next safe test:" -ForegroundColor Yellow
Write-Host "  .\scripts\test-pr004.ps1"
Write-Host ""
Write-Host "After the test succeeds:" -ForegroundColor Yellow
Write-Host "  git add ."
Write-Host '  git commit -m "PR-004: deploy Azure Bridge and connect production frontend"'
Write-Host "  git push origin main"
