# Respaldo diario con pg_dump + verificación de que el archivo es legible. ESTADO: sin ejecutar.
$Data = Join-Path $env:ProgramData 'MedicamentosPendientes'
$cfg = Get-Content (Join-Path $Data 'config.json') | ConvertFrom-Json
$bin = 'C:\Program Files\PostgreSQL\16\bin'
$destino = $cfg.respaldos; New-Item -ItemType Directory -Force $destino | Out-Null
$f = Join-Path $destino ("medpend-{0:yyyyMMdd-HHmm}.dump" -f (Get-Date))
$env:PGPASSWORD = $cfg.dbPassword
& "$bin\pg_dump.exe" -h 127.0.0.1 -p $cfg.dbPort -U medpend_app -Fc -f $f medpend
$ok = ($LASTEXITCODE -eq 0) -and (Test-Path $f)
if ($ok) { & "$bin\pg_restore.exe" --list $f | Out-Null; $ok = ($LASTEXITCODE -eq 0) }
"$(Get-Date -Format s) $(if($ok){'OK'}else{'FALLO'}) $f" | Add-Content (Join-Path $Data 'logs\respaldos.log')
Get-ChildItem $destino -Filter *.dump | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item -Force
