$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if ($nodeCommand) {
    $medsenseNode = $nodeCommand.Source
} elseif (Test-Path -LiteralPath $bundledNode) {
    $medsenseNode = $bundledNode
} else {
    Write-Host 'Install Node.js 24 or later from nodejs.org, then run this launcher again.'
    Read-Host 'Press Enter to close'
    exit 1
}
$majorVersion = [int]((& $medsenseNode --version).TrimStart('v').Split('.')[0])
if ($majorVersion -lt 24) {
    if (Test-Path -LiteralPath $bundledNode) { $medsenseNode = $bundledNode }
    else { throw 'MedSense requires Node.js 24 or later.' }
}
Write-Host 'MedSense: http://127.0.0.1:4173'
Write-Host 'Open the address in your browser. Keep this window open. Ctrl+C stops the app.'
& $medsenseNode (Join-Path $PSScriptRoot 'server.mjs')
