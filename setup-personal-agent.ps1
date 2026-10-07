param([string]$ProxyUrl)

$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot
$WebRoot = Join-Path $ProjectRoot 'web'
. (Join-Path $ProjectRoot 'scripts\windows\launcher-common.ps1')

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw '此安装脚本仅支持 Windows。' }
    Set-OptionalProxy -ProxyUrl $ProxyUrl

    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { throw '未检测到 Node.js。请安装 Node.js LTS 后重新运行本脚本。' }
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) { throw '未检测到 npm。请安装包含 npm 的 Node.js LTS 后重新运行本脚本。' }

    $packagePath = Join-Path $WebRoot 'package.json'
    $lockPath = Join-Path $WebRoot 'package-lock.json'
    if (-not (Test-Path -LiteralPath $packagePath)) { throw '找不到 web/package.json；请确认项目文件完整。' }
    if (-not (Test-Path -LiteralPath $lockPath)) { throw '找不到 web/package-lock.json；为避免改写依赖锁文件，安装已停止。' }

    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    $engine = [string]$package.engines.node
    if ($engine -notmatch '(\d+\.\d+\.\d+)') { throw '无法读取 package.json 中的 Node.js 最低版本要求。' }
    $minimumNode = [version]$Matches[1]
    $nodeOutput = (& node --version).Trim()
    if ($LASTEXITCODE -ne 0) { throw '无法读取 Node.js 版本。' }
    if ($nodeOutput -notmatch '^v?(\d+\.\d+\.\d+)') { throw '无法解析 Node.js 版本。' }
    $installedNode = [version]$Matches[1]
    if (-not (Test-NodeVersion -VersionOutput $nodeOutput -MinimumVersion $minimumNode)) { throw "Node.js $installedNode 低于项目要求 $minimumNode，请升级后重试。" }
    $npmOutput = (& npm --version).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'npm 无法正常运行，请修复 Node.js 安装后重试。' }
    Write-Host "Node.js $installedNode、npm $npmOutput 检查通过。"

    $ollama = Get-OllamaCommand
    if (-not $ollama) { throw '未检测到 Ollama。本地 AI 功能需要安装 Ollama；安装后重新运行本脚本。' }
    $ollamaVersion = (& $ollama.Source --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Ollama 命令无法正常运行，请检查安装后重试。' }
    Write-Host "Ollama 检查通过：$ollamaVersion"
    Ensure-OllamaRunning
    Ensure-QwenModel -OllamaPath $ollama.Source -AllowPull

    $examplePath = Join-Path $WebRoot '.env.example'
    $localEnvPath = Join-Path $WebRoot '.env.local'
    if (-not (Test-Path -LiteralPath $examplePath)) { throw '找不到 web/.env.example，无法安全初始化本地配置。' }
    if (-not (Test-Path -LiteralPath $localEnvPath)) {
        Copy-Item -LiteralPath $examplePath -Destination $localEnvPath
        Write-Host '已从 web/.env.example 创建 web/.env.local。'
    } else {
        Write-Host '检测到现有 web/.env.local，已保留且未读取或覆盖其中内容。'
    }

    Write-Host '正在使用 npm ci 安装锁文件指定的依赖…'
    Push-Location $WebRoot
    try {
        & npm ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci 失败，退出码 $LASTEXITCODE。未改用 npm install。" }
        Write-Host '正在构建 Next.js Production 应用…'
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw "Production build 失败，退出码 $LASTEXITCODE。" }
    } finally {
        Pop-Location
    }

    Write-Host ''
    Write-Host '初始化完成。'
    Write-Host '请在 web/.env.local 配置 Supabase 项目的 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY，然后运行 start-personal-agent.bat。'
    Write-Host '不要配置 service_role、Supabase Secret 或数据库密码。'
    exit 0
} catch {
    Write-Host "安装失败：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
