Set-StrictMode -Version Latest

function Set-OptionalProxy {
    param([string]$ProxyUrl)

    if ([string]::IsNullOrWhiteSpace($ProxyUrl)) { return }
    $uri = $null
    if (-not [Uri]::TryCreate($ProxyUrl, [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -notin @('http', 'https') -or $uri.UserInfo) {
        throw 'ProxyUrl 必须是有效的 http(s) 地址，且不能包含用户名或密码。'
    }

    $env:HTTP_PROXY = $ProxyUrl
    $env:HTTPS_PROXY = $ProxyUrl
    $env:NODE_USE_ENV_PROXY = '1'
    $env:NO_PROXY = 'localhost,127.0.0.1,::1'
    Write-Host '已为本次脚本及其子进程启用指定代理。'
}

function Test-OllamaEndpoint {
    try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -UseBasicParsing -TimeoutSec 2
        return ($response.StatusCode -eq 200)
    } catch {
        return $false
    }
}

function Get-OllamaCommand {
    $command = Get-Command ollama -ErrorAction SilentlyContinue
    if (-not $command) { return $null }
    return $command
}

function Get-NpmCliPath {
    $command = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $command) { $command = Get-Command npm -ErrorAction SilentlyContinue }
    if (-not $command -or -not $command.Source) { return $null }
    $cliPath = Join-Path (Split-Path $command.Source -Parent) 'node_modules\npm\bin\npm-cli.js'
    if (-not (Test-Path -LiteralPath $cliPath)) { return $null }
    return $cliPath
}

function Test-NodeVersion {
    param([string]$VersionOutput, [version]$MinimumVersion)
    if ($VersionOutput -notmatch '^v?(\d+\.\d+\.\d+)') { return $false }
    return ([version]$Matches[1] -ge $MinimumVersion)
}

function Get-StartupArtifactStatus {
    param([string]$WebRoot)
    return [pscustomobject]@{
        PackageManifest = Test-Path -LiteralPath (Join-Path $WebRoot 'package.json')
        Dependencies = Test-Path -LiteralPath (Join-Path $WebRoot 'node_modules')
        ProductionBuild = Test-Path -LiteralPath (Join-Path $WebRoot '.next\BUILD_ID')
        LocalEnvironment = Test-Path -LiteralPath (Join-Path $WebRoot '.env.local')
    }
}

function Ensure-OllamaRunning {
    $command = Get-OllamaCommand
    if (-not $command) { throw '未检测到 Ollama。请安装 Ollama 后重新运行。' }
    if (Test-OllamaEndpoint) {
        Write-Host 'Ollama 服务已运行。'
        return
    }

    $existingInstance = Get-Process -Name 'ollama' -ErrorAction SilentlyContinue
    if ($existingInstance) {
        Write-Host '检测到 Ollama 进程正在启动，等待现有实例就绪。'
    } else {
        Write-Host '未检测到运行中的 Ollama 服务，正在安全启动 ollama serve…'
        Start-Process -FilePath $command.Source -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
    }
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        if (Test-OllamaEndpoint) {
            Write-Host 'Ollama 服务已就绪。'
            return
        }
        Start-Sleep -Milliseconds 750
    }
    throw 'Ollama 服务在 30 秒内未就绪。请确认本机 Ollama 可在 127.0.0.1:11434 访问。'
}

function Test-QwenModel {
    param([string]$OllamaPath)
    $output = & $OllamaPath list 2>$null
    if ($LASTEXITCODE -ne 0) { return $false }
    return [bool]($output | Select-String -Pattern '^qwen3:8b(?:\s|$)' -Quiet)
}

function Ensure-QwenModel {
    param(
        [string]$OllamaPath,
        [switch]$AllowPull
    )
    if (Test-QwenModel -OllamaPath $OllamaPath) {
        Write-Host '模型 qwen3:8b 已安装。'
        return
    }
    if (-not $AllowPull) { throw '缺少 qwen3:8b。请先运行 setup-personal-agent.bat 完成模型准备。' }

    Write-Host '尚未安装 qwen3:8b。模型约数 GB，下载时间取决于网络速度。'
    $answer = Read-Host '是否现在下载 qwen3:8b？(y/N)'
    if ($answer -notmatch '^(y|yes)$') {
        Write-Warning '已跳过模型下载。Web 应用仍可启动，但本地 AI 暂不可用。'
        return
    }
    & $OllamaPath pull 'qwen3:8b'
    if ($LASTEXITCODE -ne 0) { throw '下载 qwen3:8b 失败。请检查网络后重新运行 setup。' }
}

function Get-AvailablePort {
    param([int]$PreferredPort = 3000, [int]$Attempts = 20)
    for ($port = $PreferredPort; $port -lt ($PreferredPort + $Attempts); $port++) {
        $listener = $null
        try {
            $listener = [System.Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
            $listener.Start()
            return $port
        } catch {
            # Try the next local port.
        } finally {
            if ($listener) { $listener.Stop() }
        }
    }
    throw "无法在 $PreferredPort 至 $($PreferredPort + $Attempts - 1) 之间找到空闲端口。"
}

function Test-WebReady {
    param([string]$Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 3
        return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400)
    } catch {
        if ($_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
            return ($status -ge 200 -and $status -lt 400)
        }
        return $false
    }
}

function Stop-ProcessTree {
    param([int]$RootProcessId)
    $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $ownedIds = [System.Collections.Generic.HashSet[int]]::new()
    [void]$ownedIds.Add($RootProcessId)
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($process in $processes) {
            $parentId = [int]$process.ParentProcessId
            $processId = [int]$process.ProcessId
            if ($ownedIds.Contains($parentId) -and -not $ownedIds.Contains($processId)) {
                [void]$ownedIds.Add($processId)
                $changed = $true
            }
        }
    }

    $descendants = @($ownedIds | Where-Object { $_ -ne $RootProcessId })
    foreach ($processId in $descendants) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
    $root = Get-Process -Id $RootProcessId -ErrorAction SilentlyContinue
    if ($root) {
        $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
        if (Test-Path -LiteralPath $taskkill) {
            & $taskkill /PID $RootProcessId /T /F 2>$null | Out-Null
        }
        Stop-Process -Id $RootProcessId -Force -ErrorAction SilentlyContinue
    }
}
