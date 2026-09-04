param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
$node = (Get-Command node -ErrorAction Stop).Source
$required = @(
  '.feelfish\solution.json',
  '.feelfish\solutions\feelfish-custom.json',
  'NovelOS\00-control\capability-model-map.json',
  'NovelOS\04-canon\entity-state-ledger.json',
  'NovelOS\tools\mcp-server\novelos-mcp.mjs'
)

foreach ($relative in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $relative))) {
    throw "NovelOS file missing: $relative"
  }
}

if (-not $CheckOnly) {
  foreach ($relative in @('chapters', 'records', 'assets', 'roles', 'objects', 'outline', 'inspirations', 'rules')) {
    New-Item -ItemType Directory -Path (Join-Path $root $relative) -Force | Out-Null
  }
  $template = Join-Path $root 'NovelOS\tools\mcp-server\mcp-config.template.json'
  $local = Join-Path $root 'NovelOS\tools\mcp-server\mcp-config.local.json'
  if (-not (Test-Path -LiteralPath $local)) {
    $jsonRoot = $root.Replace('\', '/')
    $content = [IO.File]::ReadAllText($template, [Text.UTF8Encoding]::new($false)).Replace('<PROJECT_ROOT>', $jsonRoot)
    [IO.File]::WriteAllText($local, $content, [Text.UTF8Encoding]::new($false))
  }
  & $node (Join-Path $root 'NovelOS\tools\config\sync-model-routing.mjs') --root $root --write
  if ($LASTEXITCODE -ne 0) { throw 'Model routing sync failed' }
}

& $node (Join-Path $root 'NovelOS\tools\config\sync-model-routing.mjs') --root $root
if ($LASTEXITCODE -ne 0) { throw 'Model routing check failed' }
& $node (Join-Path $root 'NovelOS\tools\config\check-system-topology.mjs') --root $root
if ($LASTEXITCODE -ne 0) { throw 'NovelOS topology check failed' }

[pscustomobject]@{
  Status = 'READY'
  ProjectRoot = $root
  PrimaryAgent = 'novelos-director'
  Solution = 'feelfish-custom'
  ModelCalls = 0
  NextStep = 'Open this folder as a FeelFish novel project and select NovelOS 番茄超级写作者.'
}
