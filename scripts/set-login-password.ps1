$ErrorActionPreference = "Stop"
$FunctionApp = "juliette-control-api"
$ResourceGroup = "JULIETTE-CONTROL"

$secure = Read-Host "Nueva contraseña de Juliette Control Center" -AsSecureString
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

$iterations = 310000
$salt = New-Object byte[] 16
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($salt)
$derive = New-Object Security.Cryptography.Rfc2898DeriveBytes(
  $password,
  $salt,
  $iterations,
  [Security.Cryptography.HashAlgorithmName]::SHA256
)
$digest = $derive.GetBytes(32)

function ConvertTo-B64Url([byte[]]$bytes) {
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}

$value = "pbkdf2_sha256$" + $iterations + "$" + (ConvertTo-B64Url $salt) + "$" + (ConvertTo-B64Url $digest)

az functionapp config appsettings set `
  --name $FunctionApp `
  --resource-group $ResourceGroup `
  --settings "CONTROL_LOGIN_PASSWORD_HASH=$value" `
  --output none

if ($LASTEXITCODE -ne 0) { throw "Azure no pudo guardar la contraseña." }
Write-Host "Contraseña configurada correctamente." -ForegroundColor Green
