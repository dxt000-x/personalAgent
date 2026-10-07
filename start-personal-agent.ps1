param([string]$ProxyUrl)

$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot
$WebRoot = Join-Path $ProjectRoot 'web'
. (Join-Path $ProjectRoot 'scripts\windows\launcher-common.ps1')
$serverProcess = $null

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw '此启动脚本仅支持 Windows。' }
    Set-OptionalProxy -ProxyUrl $ProxyUrl

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '未检测到 Node.js，请先安装 Node.js LTS 并运行 setup-personal-agent.bat。' }
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { throw '未检测到 Node.js，请先安装 Node.js LTS 并运行 setup-personal-agent.bat。' }
    $npmCli = Get-NpmCliPath
    if (-not $npmCli) { throw '找不到 npm CLI，请重新安装包含 npm 的 Node.js LTS 后重试。' }
    $artifacts = Get-StartupArtifactStatus -WebRoot $WebRoot
    if (-not $artifacts.PackageManifest) { throw '找不到 web/package.json；项目文件不完整。' }
    if (-not $artifacts.Dependencies) { throw '尚未安装依赖，请先运行 setup-personal-agent.bat。' }
    if (-not $artifacts.ProductionBuild) { throw '找不到 Production build，请先运行 setup-personal-agent.bat。' }

    $examplePath = Join-Path $WebRoot '.env.example'
    $localEnvPath = Join-Path $WebRoot '.env.local'
    if (-not $artifacts.LocalEnvironment) {
        if (-not (Test-Path -LiteralPath $examplePath)) { throw '缺少 web/.env.local 和 web/.env.example。' }
        Copy-Item -LiteralPath $examplePath -Destination $localEnvPath
        Write-Warning '已创建 web/.env.local 模板。请配置 Supabase Public URL 和 Publishable Key 后重新启动。'
        throw 'Supabase 环境模板尚未配置。'
    }
    $envText = Get-Content -LiteralPath $localEnvPath -Raw
    $urlConfigured = $envText -match '(?m)^\s*NEXT_PUBLIC_SUPABASE_URL\s*=\s*\S+'
    $keyConfigured = $envText -match '(?m)^\s*NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\s*=\s*\S+'
    if (-not ($urlConfigured -and $keyConfigured)) {
        Write-Warning 'Supabase Public 配置尚未填写；登录与受保护页面不可用。请配置 web/.env.local。'
    }
    Remove-Variable envText

    $ollama = Get-OllamaCommand
    if (-not $ollama) { throw '未检测到 Ollama。本地 AI 需要安装 Ollama；安装后运行 setup-personal-agent.bat。' }
    Ensure-OllamaRunning
    Ensure-QwenModel -OllamaPath $ollama.Source

    $port = Get-AvailablePort -PreferredPort 3000 -Attempts 20
    $url = "http://localhost:$port"
    $arguments = @($npmCli, 'start', '--', '--hostname', '127.0.0.1', '--port', [string]$port)
    $quotedArguments = ($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
    $serverProcess = Start-Process -FilePath $node.Source -ArgumentList $quotedArguments -WorkingDirectory $WebRoot -PassThru -NoNewWindow
    Write-Host "正在启动 Personal AI，等待 $url 就绪…"

    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
        if ($serverProcess.HasExited) { throw "Next.js Production Server 已退出，退出码 $($serverProcess.ExitCode)。" }
        if (Test-WebReady -Url $url) { break }
        Start-Sleep -Milliseconds 750
    }
    if (-not (Test-WebReady -Url $url)) { throw 'Next.js 服务在 90 秒内未通过健康检查。' }

    Write-Host ''
    Write-Host "Personal AI 已就绪：$url" -ForegroundColor Green
    Write-Host '按 Ctrl+C 停止 Personal AI。'
    try { Start-Process $url | Out-Null } catch { Write-Warning '无法自动打开浏览器，请复制上方地址到浏览器。' }

    while (-not $serverProcess.WaitForExit(500)) { }
    if ($serverProcess.ExitCode -ne 0) { throw "Next.js Production Server 退出，退出码 $($serverProcess.ExitCode)。" }
} catch [System.Management.Automation.PipelineStoppedException] {
    Write-Host '正在停止 Personal AI…'
} catch {
    Write-Host "启动失败：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if ($serverProcess) {
        Stop-ProcessTree -RootProcessId $serverProcess.Id
    }
}
