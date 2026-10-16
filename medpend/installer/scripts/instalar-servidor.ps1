# Configura la COMPUTADORA PRINCIPAL. Lo ejecuta el instalador de forma oculta. ESTADO: escrito, sin ejecutar en Windows.
param([Parameter(Mandatory)][string]$AppDir)
$ErrorActionPreference = 'Stop'
$Data = Join-Path $env:ProgramData 'MedicamentosPendientes'
$Logs = Join-Path $Data 'logs'; $Back = Join-Path $Data 'respaldos'
New-Item -ItemType Directory -Force $Data, $Logs, $Back | Out-Null
$Log = Join-Path $Logs 'instalacion.log'
function Log($m) { "$(Get-Date -Format s) $m" | Add-Content $Log }
function ClaveAleatoria { -join ((48..57 + 65..90 + 97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ }) }
try {
  Log 'Inicio de configuración del servidor'
  if ([Environment]::OSVersion.Version.Major -lt 10 -or -not [Environment]::Is64BitOperatingSystem) { throw 'Se requiere Windows 10 u 11 de 64 bits.' }
  if ((Get-PSDrive C).Free -lt 3GB) { throw 'Se necesitan al menos 3 GB libres en el disco C.' }

  # Reutilizar configuración existente (actualización / reparación): no se regeneran claves ni se toca la base de datos.
  $CfgPath = Join-Path $Data 'config.json'
  $nueva = -not (Test-Path $CfgPath)
  $PgPort = 5433; $PgSvc = 'postgresql-medpend'; $PgDir = 'C:\Program Files\PostgreSQL\16'
  $psql = Join-Path $PgDir 'bin\psql.exe'

  if ($nueva) {
    $super = ClaveAleatoria; $appPwd = ClaveAleatoria; $pfxPwd = ClaveAleatoria
    # Instancia propia de PostgreSQL (puerto 5433, solo local). No se toca ninguna instalación existente.
    if (-not (Get-Service $PgSvc -ErrorAction SilentlyContinue)) {
      $inst = Join-Path $AppDir 'redist\postgresql-16-x64.exe'
      if (-not (Test-Path $inst)) { throw 'Falta el instalador de PostgreSQL dentro del paquete.' }
      Log 'Instalando PostgreSQL (instancia propia)'
      $p = Start-Process $inst -Wait -PassThru -ArgumentList "--mode unattended --unattendedmodeui none --superpassword `"$super`" --servicename $PgSvc --serverport $PgPort --enable-components server,commandlinetools --disable-components pgAdmin,stackbuilder"
      if ($p.ExitCode -ne 0) { throw "La instalación de PostgreSQL terminó con código $($p.ExitCode)." }
    }
    # PostgreSQL solo escucha en localhost
    $conf = Join-Path $PgDir 'data\postgresql.conf'
    (Get-Content $conf) -replace "^#?listen_addresses.*", "listen_addresses = '127.0.0.1'" | Set-Content $conf
    Restart-Service $PgSvc; Start-Sleep 5

    $env:PGPASSWORD = $super
    & $psql -h 127.0.0.1 -p $PgPort -U postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE medpend_app LOGIN PASSWORD '$appPwd'" -c "CREATE DATABASE medpend"
    Get-ChildItem (Join-Path $AppDir 'db\migrations\*.sql') | Sort-Object Name | ForEach-Object {
      Log "Migración $($_.Name)"; & $psql -h 127.0.0.1 -p $PgPort -U postgres -d medpend -v ON_ERROR_STOP=1 -f $_.FullName
      if ($LASTEXITCODE -ne 0) { throw "Falló la migración $($_.Name)" } }
    & $psql -h 127.0.0.1 -p $PgPort -U postgres -d medpend -v ON_ERROR_STOP=1 -c "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO medpend_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO medpend_app;"

    # Certificado autofirmado (los clientes validan su huella, no se desactiva TLS)
    $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127|169)\.' } | Select-Object -First 1).IPAddress
    $cert = New-SelfSignedCertificate -Subject 'CN=MedicamentosPendientes' -DnsName 'medpend.local', $env:COMPUTERNAME -CertStoreLocation Cert:\LocalMachine\My -NotAfter (Get-Date).AddYears(10) -KeyExportPolicy Exportable
    Export-PfxCertificate -Cert $cert -FilePath (Join-Path $Data 'servidor.pfx') -Password (ConvertTo-SecureString $pfxPwd -AsPlainText -Force) | Out-Null
    $cfg = @{ dbPort = $PgPort; dbPassword = $appPwd; pfxPassword = $pfxPwd; apiPort = 8443; certFingerprint = $cert.GetCertHashString('SHA256'); respaldos = $Back }
    $cfg | ConvertTo-Json | Set-Content $CfgPath -Encoding UTF8
    # Solo SYSTEM y Administradores pueden leer la configuración (contiene claves)
    icacls $Data /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null
    Remove-Item Env:PGPASSWORD
  }

  # Servicio de Windows (WinSW): inicio automático y reinicio ante fallos
  $svcDir = Join-Path $AppDir 'servicio'; $exe = Join-Path $svcDir 'MedPendApi.exe'
  if (-not (Get-Service 'MedPendApi' -ErrorAction SilentlyContinue)) { & $exe install | Out-Null }
  Start-Service 'MedPendApi'; Start-Sleep 4
  if ((Get-Service 'MedPendApi').Status -ne 'Running') { throw 'El servicio de la API no pudo iniciar. Revise los registros en ProgramData\MedicamentosPendientes\logs.' }

  # Firewall: solo la API, solo red local. PostgreSQL NO se abre.
  if (-not (Get-NetFirewallRule -DisplayName 'Medicamentos Pendientes API' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'Medicamentos Pendientes API' -Direction Inbound -Protocol TCP -LocalPort 8443 -RemoteAddress LocalSubnet -Action Allow | Out-Null }

  # Copia de seguridad diaria (el administrador debe elegir además una unidad independiente en el programa)
  $bk = Join-Path $AppDir 'scripts\respaldo.ps1'
  schtasks /Create /F /TN 'MedPend Respaldo' /SC DAILY /ST 22:00 /RU SYSTEM /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$bk`"" | Out-Null

  if (-not (Test-NetConnection 127.0.0.1 -Port 8443 -InformationLevel Quiet)) { throw 'La API no responde en el puerto 8443.' }
  Log 'Servidor configurado correctamente'
} catch { Log "ERROR: $_"; throw }
