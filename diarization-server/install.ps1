# One-shot installer for the referat diarization server (Windows).
#
#   powershell -ExecutionPolicy Bypass -File install.ps1
#
# Does three things: installs uv if missing, installs the Python environment
# (uv sync), and walks through the one-time Hugging Face model-access login.
# Safe to re-run; every step is skipped when already done.

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

function Resolve-Uv {
    $cmd = Get-Command uv -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $local = Join-Path $env:USERPROFILE '.local\bin\uv.exe'
    if (Test-Path $local) { return $local }
    return $null
}

Write-Host ''
Write-Host '=== referat diarization server - install ===' -ForegroundColor Green
Write-Host ''

# --- 1. uv ---------------------------------------------------------------
$uv = Resolve-Uv
if ($uv) {
    Write-Host "[1/3] uv found: $uv"
} else {
    Write-Host '[1/3] Installing uv (Python package manager, https://astral.sh/uv) ...'
    Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
    $uv = Resolve-Uv
    if (-not $uv) { throw 'uv installation failed - install it manually from https://docs.astral.sh/uv/ and re-run.' }
    Write-Host "      uv installed: $uv"
}

# --- 2. Python environment ------------------------------------------------
Write-Host '[2/3] Installing the Python environment (first run downloads ~3 GB, mostly CUDA-enabled PyTorch) ...'
& $uv sync
if ($LASTEXITCODE -ne 0) { throw 'uv sync failed - see the output above.' }
Write-Host '      Environment ready.'

# --- 3. Hugging Face model access -----------------------------------------
$tokenPath = Join-Path $env:USERPROFILE '.cache\huggingface\token'
if ((Test-Path $tokenPath) -or $env:HF_TOKEN) {
    Write-Host '[3/3] Hugging Face login found - skipping.'
} else {
    Write-Host '[3/3] One-time Hugging Face setup.'
    Write-Host ''
    Write-Host '      The speaker models are gated: you need a free Hugging Face account' -ForegroundColor Yellow
    Write-Host '      and must accept the conditions on these model pages (opening them now):' -ForegroundColor Yellow
    Write-Host ''
    $pages = @(
        'https://huggingface.co/pyannote/speaker-diarization-community-1',
        'https://huggingface.co/pyannote/speaker-diarization-3.1',
        'https://huggingface.co/pyannote/segmentation-3.0'
    )
    foreach ($p in $pages) { Write-Host "        $p"; Start-Process $p }
    Write-Host ''
    Write-Host '      When done, create an access token (Settings -> Access Tokens -> read),'
    Write-Host '      and paste it below.'
    Write-Host ''
    & $uv tool run 'huggingface_hub[cli]' auth login
    if ($LASTEXITCODE -ne 0) { throw 'Hugging Face login failed - re-run this script to try again.' }
}

Write-Host ''
Write-Host 'Done. Start the server with start-server.bat (or: uv run diarization-server).' -ForegroundColor Green
Write-Host 'First start downloads the model itself (a few hundred MB); later starts take ~10-30 s.'
Write-Host 'Then, in referat: Installningar -> Talare -> address http://127.0.0.1:8300 -> Testa anslutning.'
