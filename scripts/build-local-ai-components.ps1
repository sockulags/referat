param(
  [ValidateSet('transcription-cpu', 'diarization-cpu', 'diarization-gpu', 'all')]
  [string]$Component = 'all',
  [string]$CertificateSha1 = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path $root 'dist\local-ai-components'
New-Item -ItemType Directory -Force -Path $output | Out-Null

function Sign-Executable([string]$path) {
  if (-not $CertificateSha1) { return }
  $signtool = Get-ChildItem "$env:LOCALAPPDATA\electron-builder\Cache" -Recurse `
    -Filter signtool.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\windows-10\\x64\\signtool\.exe$' } |
    Select-Object -First 1 -ExpandProperty FullName
  if (-not $signtool) { throw 'signtool.exe not found; run an Electron Windows build first.' }
  & $signtool sign /sha1 $CertificateSha1 /s My /fd SHA256 `
    /tr http://timestamp.digicert.com /td SHA256 $path
  if ($LASTEXITCODE -ne 0) { throw "Signing failed: $path" }
}

function Package-Directory([string]$source, [string]$assetName) {
  $zip = Join-Path $output $assetName
  if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
  Compress-Archive -Path (Join-Path $source '*') -DestinationPath $zip -CompressionLevel Optimal
  $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
  Set-Content -LiteralPath "$zip.sha256" -Value "$hash  $assetName" -Encoding ascii
}

function Split-LargeArchive([string]$assetName) {
  $zip = Join-Path $output $assetName
  $partSize = [int64](1800MB)
  $buffer = New-Object byte[] (8MB)
  $input = [IO.File]::OpenRead($zip)
  try {
    $partNumber = 1
    while ($input.Position -lt $input.Length) {
      $partName = "$assetName.part$($partNumber.ToString('00'))"
      $partPath = Join-Path $output $partName
      $part = [IO.File]::Create($partPath)
      try {
      $remaining = [Math]::Min([int64]$partSize, [int64]($input.Length - $input.Position))
      while ($remaining -gt 0) {
          $readSize = [int][Math]::Min([int64]$buffer.Length, [int64]$remaining)
          $count = $input.Read($buffer, 0, $readSize)
          if ($count -le 0) { break }
          $part.Write($buffer, 0, $count)
          $remaining -= $count
        }
      } finally { $part.Dispose() }
      $hash = (Get-FileHash -LiteralPath $partPath -Algorithm SHA256).Hash.ToLowerInvariant()
      Set-Content -LiteralPath "$partPath.sha256" -Value "$hash  $partName" -Encoding ascii
      $partNumber += 1
    }
  } finally { $input.Dispose() }
  Remove-Item -LiteralPath $zip -Force
}

function Build-TranscriptionCpu {
  $project = Join-Path $root 'transcription-server'
  Push-Location $project
  try {
    uv sync --group dev
    uv run pyinstaller --noconfirm --clean --onedir --name referat-transcription `
      --collect-data faster_whisper --collect-all av `
      'runtime_entry.py'
    $runtime = Join-Path $project 'dist\referat-transcription'
    Sign-Executable (Join-Path $runtime 'referat-transcription.exe')
    Package-Directory $runtime `
      'referat-transcription-cpu-win-x64.zip'
  } finally { Pop-Location }
}

function Build-Diarization([bool]$gpu) {
  $sourceProject = Join-Path $root 'diarization-server'
  $project = $sourceProject
  $tempProject = $null
  if (-not $gpu) {
    # Keep this deliberately short: PyTorch contains deeply nested license
    # paths and PyInstaller otherwise hits Windows MAX_PATH during COLLECT.
    $tempProject = Join-Path ([IO.Path]::GetTempPath()) ("rdc-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $tempProject | Out-Null
    Copy-Item -LiteralPath (Join-Path $sourceProject 'pyproject.toml') -Destination $tempProject
    Copy-Item -LiteralPath (Join-Path $sourceProject 'README.md') -Destination $tempProject
    Copy-Item -LiteralPath (Join-Path $sourceProject 'runtime_entry.py') -Destination $tempProject
    Copy-Item -LiteralPath (Join-Path $sourceProject 'src') -Destination $tempProject -Recurse
    $toml = Get-Content -LiteralPath (Join-Path $tempProject 'pyproject.toml') -Raw
    $toml = $toml.Replace('pytorch-cu128', 'pytorch-cpu')
    $toml = $toml.Replace('https://download.pytorch.org/whl/cu128', 'https://download.pytorch.org/whl/cpu')
    Set-Content -LiteralPath (Join-Path $tempProject 'pyproject.toml') -Value $toml -Encoding utf8
    $project = $tempProject
  }
  Push-Location $project
  try {
    uv sync --group dev
    $name = if ($gpu) { 'referat-diarization-gpu-win-x64.zip' } else { 'referat-diarization-cpu-win-x64.zip' }
    uv run pyinstaller --noconfirm --clean --onedir --name referat-diarization `
      --collect-all pyannote.audio --collect-all torch --collect-all torchaudio `
      --collect-all av 'runtime_entry.py'
    $runtime = Join-Path $project 'dist\referat-diarization'
    Sign-Executable (Join-Path $runtime 'referat-diarization.exe')
    Package-Directory $runtime $name
    if ($gpu) { Split-LargeArchive $name }
  } finally {
    Pop-Location
    if ($tempProject -and (Test-Path -LiteralPath $tempProject)) {
      Remove-Item -LiteralPath $tempProject -Recurse -Force
    }
  }
}

if ($Component -in @('transcription-cpu', 'all')) { Build-TranscriptionCpu }
if ($Component -in @('diarization-cpu', 'all')) { Build-Diarization $false }
if ($Component -in @('diarization-gpu', 'all')) { Build-Diarization $true }
