param(
  [ValidateSet('bootstrap', 'start', 'stop', 'status', 'logs', 'rebuild-web', 'rebuild-server', 'recreate-server', 'start-media', 'stop-media', 'model-config', 'validate')]
  [string]$Action = 'status',
  [string]$Service = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $Root '.env.docker'
$ComposeFile = Join-Path $Root 'docker-compose.dev.yml'
$Project = 'educlaw-dev'
$AuthNetwork = 'auth-service_internal-net'

if (-not (Test-Path -LiteralPath $EnvFile)) {
  throw "Missing $EnvFile. Create the ignored development environment file first."
}

if (-not (Test-Path -LiteralPath $ComposeFile)) {
  throw "Missing $ComposeFile."
}

if ($Action -ne 'model-config' -and (docker context show) -ne 'desktop-linux') {
  throw 'Docker context must be desktop-linux for the local development environment.'
}

function Assert-AuthNetwork {
  if (-not (docker network inspect $AuthNetwork 2>$null)) {
    throw "Shared authentication network '$AuthNetwork' is unavailable. Start the existing auth-service project first."
  }
}

$ComposeArgs = @(
  'compose',
  '--project-name', $Project,
  '--env-file', $EnvFile,
  '--file', $ComposeFile
)

function Invoke-Compose {
  param([string[]]$Arguments)
  & docker @ComposeArgs @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose failed with exit code $LASTEXITCODE"
  }
}

function Show-ModelConfig {
  $values = @{}
  Get-Content -LiteralPath $EnvFile -Encoding UTF8 | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      $values[$matches[1]] = $matches[2]
    }
  }

  Write-Output "LLM_BASE_URL=$($values['LLM_BASE_URL'])"
  Write-Output "LLM_MODEL=$($values['LLM_MODEL'])"
  Write-Output "LLM_API_KEY_PRESENT=$([bool](-not [string]::IsNullOrWhiteSpace($values['LLM_API_KEY'])))"
  Write-Output "APP_ORIGIN=$($values['APP_ORIGIN'])"
}

switch ($Action) {
  'bootstrap' {
    Assert-AuthNetwork
    Invoke-Compose @('config', '--quiet')
    Invoke-Compose @('up', '-d', '--build', 'educlaw-web')
    Write-Output 'EduSkill development site: http://app.localhost/'
  }
  'start' {
    Assert-AuthNetwork
    Invoke-Compose @('config', '--quiet')
    Invoke-Compose @('up', '-d', '--no-deps', '--wait', 'educlaw-db', 'educlaw-minio')
    Invoke-Compose @('up', '-d', '--no-deps', '--wait', 'educlaw-server')
    Invoke-Compose @('up', '-d', '--no-deps', 'educlaw-web')
    Write-Output 'EduSkill development site: http://app.localhost/'
  }
  'stop' {
    Invoke-Compose @('stop')
  }
  'status' {
    Invoke-Compose @('ps', '-a')
  }
  'logs' {
    $args = @('logs', '--tail', '200', '--follow')
    if ($Service) { $args += $Service }
    Invoke-Compose $args
  }
  'rebuild-web' {
    Invoke-Compose @('build', 'educlaw-web')
    Invoke-Compose @('up', '-d', '--no-deps', 'educlaw-web')
  }
  'rebuild-server' {
    Invoke-Compose @('build', 'educlaw-server', 'educlaw-db-init')
    Invoke-Compose @('run', '--rm', 'educlaw-db-init')
    Invoke-Compose @('up', '-d', '--no-deps', 'educlaw-server')
  }
  'recreate-server' {
    Invoke-Compose @('up', '-d', '--no-deps', '--force-recreate', 'educlaw-server')
  }
  'start-media' {
    Invoke-Compose @('--profile', 'media', 'up', '-d', '--build', 'educlaw-media-quality-worker', 'educlaw-media-distillation-worker')
  }
  'stop-media' {
    Invoke-Compose @('--profile', 'media', 'stop', 'educlaw-media-quality-worker', 'educlaw-media-distillation-worker')
  }
  'model-config' {
    Show-ModelConfig
  }
  'validate' {
    Invoke-Compose @('config', '--quiet')
    Show-ModelConfig
  }
}
