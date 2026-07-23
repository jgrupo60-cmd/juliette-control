param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9._-]{2,40}$')]
  [string]$Username,
  [string]$DisplayName = "",
  [switch]$Remove,
  [string]$FunctionApp = "juliette-control-api",
  [string]$ResourceGroup = "JULIETTE-CONTROL"
)

$ErrorActionPreference = "Stop"

function ConvertFrom-B64Url([string]$value) {
  $value = $value.Replace('-', '+').Replace('_', '/')
  while (($value.Length % 4) -ne 0) { $value += '=' }
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($value))
}

function ConvertTo-B64Url([byte[]]$bytes) {
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}

function New-PasswordHash([string]$password) {
  $iterations = 310000
  $salt = New-Object byte[] 16
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($salt) } finally { $rng.Dispose() }
  $derive = New-Object Security.Cryptography.Rfc2898DeriveBytes(
    $password,
    $salt,
    $iterations,
    [Security.Cryptography.HashAlgorithmName]::SHA256
  )
  try { $digest = $derive.GetBytes(32) } finally { $derive.Dispose() }
  return "pbkdf2_sha256$" + $iterations + "$" + (ConvertTo-B64Url $salt) + "$" + (ConvertTo-B64Url $digest)
}

Write-Host "Leyendo usuarios actuales..." -ForegroundColor Cyan
$current = az functionapp config appsettings list `
  --name $FunctionApp `
  --resource-group $ResourceGroup `
  --query "[?name=='CONTROL_USERS_B64'].value | [0]" `
  --output tsv `
  --only-show-errors

if ($LASTEXITCODE -ne 0) { throw "No se pudo leer la configuración de Azure." }

$users = @{}
if (-not [string]::IsNullOrWhiteSpace($current)) {
  try {
    $decoded = ConvertFrom-B64Url $current
    $parsed = $decoded | ConvertFrom-Json
    if ($parsed) {
      foreach ($property in $parsed.PSObject.Properties) {
        $users[$property.Name] = @{
          displayName = [string]$property.Value.displayName
          passwordHash = [string]$property.Value.passwordHash
        }
      }
    }
  } catch {
    throw "CONTROL_USERS_B64 existe, pero no tiene un formato válido."
  }
}

$key = $Username.Trim().ToLowerInvariant()

if ($Remove) {
  if (-not $users.ContainsKey($key)) { throw "El usuario '$Username' no existe." }
  $users.Remove($key)
  if ($users.Count -eq 0) { throw "No puedes eliminar el último usuario autorizado." }
  Write-Host "Usuario '$Username' eliminado." -ForegroundColor Yellow
} else {
  $secure = Read-Host "Contraseña para $Username" -AsSecureString
  $confirm = Read-Host "Repite la contraseña" -AsSecureString
  $ptr1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $ptr2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirm)
  try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr1)
    $password2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr2)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr1)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr2)
  }

  if ($password -ne $password2) { throw "Las contraseñas no coinciden." }
  if ($password.Length -lt 12) { throw "Usa una contraseña de al menos 12 caracteres." }

  if ([string]::IsNullOrWhiteSpace($DisplayName)) { $DisplayName = $Username }
  $trimmedDisplayName = $DisplayName.Trim()
  if ($trimmedDisplayName.Length -gt 40) { $trimmedDisplayName = $trimmedDisplayName.Substring(0, 40) }
  $users[$key] = @{
    displayName = $trimmedDisplayName
    passwordHash = New-PasswordHash $password
  }
  Write-Host "Usuario '$Username' agregado o actualizado." -ForegroundColor Green
}

$json = $users | ConvertTo-Json -Depth 4 -Compress
$encoded = ConvertTo-B64Url ([Text.Encoding]::UTF8.GetBytes($json))

az functionapp config appsettings set `
  --name $FunctionApp `
  --resource-group $ResourceGroup `
  --settings "CONTROL_USERS_B64=$encoded" `
  --output none `
  --only-show-errors

if ($LASTEXITCODE -ne 0) { throw "Azure no pudo guardar los usuarios." }

az functionapp config appsettings delete `
  --name $FunctionApp `
  --resource-group $ResourceGroup `
  --setting-names CONTROL_LOGIN_PASSWORD_HASH `
  --output none `
  --only-show-errors 2>$null

az functionapp restart --name $FunctionApp --resource-group $ResourceGroup --output none --only-show-errors
if ($LASTEXITCODE -ne 0) { throw "Los usuarios se guardaron, pero Azure no pudo reiniciar la Function App." }

Write-Host "Configuración aplicada. Usuarios autorizados:" -ForegroundColor Cyan
$users.Keys | Sort-Object | ForEach-Object { Write-Host "  - $_" }
