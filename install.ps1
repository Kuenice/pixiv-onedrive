[CmdletBinding()]
param(
    [string]$DownloadDir = "",
    [switch]$NoStartup,
    [switch]$NoOpen,
    [switch]$HelperOnly,
    [switch]$OnDemand,
    [int]$IdleExitMinutes = -1
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host ("==> " + $Message) -ForegroundColor Cyan
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Text)
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Get-ExtensionIdFromKey {
    param([string]$KeyBase64)

    try {
        $der = [Convert]::FromBase64String($KeyBase64)
        $sha = [System.Security.Cryptography.SHA256]::Create().ComputeHash($der)
        $alphabet = "abcdefghijklmnop"
        $builder = New-Object System.Text.StringBuilder
        for ($i = 0; $i -lt 16; $i++) {
            $byte = $sha[$i]
            [void]$builder.Append($alphabet[$byte -shr 4])
            [void]$builder.Append($alphabet[$byte -band 0x0F])
        }
        return $builder.ToString()
    } catch {
        return $null
    }
}

function Stop-HelperProcesses {
    $processes = Get-CimInstance Win32_Process -Filter "Name = 'PixivOneDriveHelper.exe'" -ErrorAction SilentlyContinue
    foreach ($process in $processes) {
        try {
            Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
            Write-Host ("已停止旧的本地助手进程 " + $process.ProcessId)
        } catch {
            Write-Warning ("无法停止旧的本地助手进程 " + $process.ProcessId + "：" + $_.Exception.Message)
        }
    }
    Start-Sleep -Milliseconds 350
}

function Test-PortFree {
    param([int]$Port)
    try {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        $listener.Stop()
        return $true
    } catch {
        return $false
    }
}

try {
    $root = $PSScriptRoot
    $extensionSource = Join-Path $root "extension"
    $helperSourceDir = Join-Path $root "helper"
    $helperSource = Join-Path $helperSourceDir "PixivOneDriveHelper.cs"
    $prebuiltHelper = Join-Path $helperSourceDir "PixivOneDriveHelper.exe"
    $launcherSourceDir = Join-Path $root "launcher"
    $launcherSource = Join-Path $launcherSourceDir "PixivOneDriveLauncher.cs"
    $prebuiltLauncher = Join-Path $launcherSourceDir "PixivOneDriveLauncher.exe"

    if (-not (Test-Path (Join-Path $extensionSource "manifest.json"))) {
        throw "找不到 extension\manifest.json。请确保压缩包已完整解压。"
    }
    if (-not (Test-Path $helperSource)) {
        throw "找不到 helper\PixivOneDriveHelper.cs。请确保压缩包已完整解压。"
    }

    $installDir = Join-Path $env:LOCALAPPDATA "PixivOneDrive"
    $extensionDir = Join-Path $installDir "extension"
    $configPath = Join-Path $installDir "config.json"
    $exePath = Join-Path $installDir "PixivOneDriveHelper.exe"
    $sourcePath = Join-Path $installDir "PixivOneDriveHelper.cs"
    $launcherPath = Join-Path $installDir "PixivOneDriveLauncher.exe"

    New-Item -ItemType Directory -Force -Path $installDir | Out-Null

    if ($IdleExitMinutes -lt 0) {
        if ($OnDemand) {
            $IdleExitMinutes = 15
        } else {
            $IdleExitMinutes = 0
        }
    }

    $oldConfig = $null
    if (Test-Path $configPath) {
        try {
            $oldConfig = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
        } catch {
            Write-Warning "旧的 config.json 无法读取，将重新生成。"
        }
    }

    if ([string]::IsNullOrWhiteSpace($DownloadDir)) {
        if ($oldConfig -and -not [string]::IsNullOrWhiteSpace($oldConfig.downloadDir)) {
            $DownloadDir = [string]$oldConfig.downloadDir
        } else {
            $oneDrive = $env:OneDrive
            if ([string]::IsNullOrWhiteSpace($oneDrive)) {
                $oneDrive = $env:OneDriveConsumer
            }
            if ([string]::IsNullOrWhiteSpace($oneDrive)) {
                $oneDrive = $env:OneDriveCommercial
            }
            if ([string]::IsNullOrWhiteSpace($oneDrive)) {
                $oneDrive = Join-Path $env:USERPROFILE "OneDrive"
                Write-Warning "没有检测到 OneDrive 环境变量，将使用：$oneDrive"
            }
            $DownloadDir = Join-Path $oneDrive "pixiv"
        }
    }

    $DownloadDir = [System.IO.Path]::GetFullPath($DownloadDir)
    New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null

    Write-Step "停止旧的本地助手"
    Stop-HelperProcesses

    $token = ""
    if ($oldConfig -and $oldConfig.token -match "^[0-9a-fA-F]{32,128}$") {
        $token = [string]$oldConfig.token
    }
    if ([string]::IsNullOrWhiteSpace($token)) {
        $bytes = New-Object byte[] 32
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try {
            $rng.GetBytes($bytes)
        } finally {
            $rng.Dispose()
        }
        $token = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    }

    $port = 39391
    if ($oldConfig -and [int]$oldConfig.port -ge 1024 -and [int]$oldConfig.port -le 65535) {
        $port = [int]$oldConfig.port
    }
    if (-not (Test-PortFree $port)) {
        $originalPort = $port
        $found = $false
        for ($candidate = $originalPort + 1; $candidate -le $originalPort + 40; $candidate++) {
            if (Test-PortFree $candidate) {
                $port = $candidate
                $found = $true
                break
            }
        }
        if (-not $found) {
            throw "找不到可用的本地端口（从 $originalPort 开始尝试了 40 个端口）。"
        }
        Write-Warning "端口 $originalPort 已被占用，改用端口 $port。"
    }

    Write-Step "安装本地助手"
    Copy-Item $helperSource $sourcePath -Force

    $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
    if (-not (Test-Path $csc)) {
        $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
    }

    $compiled = $false
    if (Test-Path $csc) {
        Write-Host "正在编译 PixivOneDriveHelper.exe ..."
        $compilerArgs = @(
            "/nologo",
            "/target:winexe",
            "/optimize+",
            "/codepage:65001",
            "/platform:anycpu",
            ("/out:" + $exePath),
            "/r:System.Core.dll",
            "/r:System.Web.Extensions.dll",
            "/r:System.Net.Http.dll",
            $sourcePath
        )
        $compilerOutput = & $csc $compilerArgs 2>&1
        if ($LASTEXITCODE -eq 0 -and (Test-Path $exePath)) {
            $compiled = $true
        } else {
            Write-Warning ("编译失败，尝试使用预编译版本。编译器输出：" + ($compilerOutput -join " "))
        }
    }

    if (-not $compiled) {
        if (-not (Test-Path $prebuiltHelper)) {
            throw "本地助手编译失败，且找不到预编译的 PixivOneDriveHelper.exe。"
        }
        Copy-Item $prebuiltHelper $exePath -Force
        Write-Warning "已使用预编译的本地助手。"
    }

    Write-Step "安装按需启动器"
    if (Test-Path $launcherSource) {
        $launcherCompiled = $false
        if (Test-Path $csc) {
            $launcherArgs = @(
                "/nologo",
                "/target:winexe",
                "/optimize+",
                "/codepage:65001",
                "/platform:anycpu",
                ("/out:" + $launcherPath),
                $launcherSource
            )
            $launcherOutput = & $csc $launcherArgs 2>&1
            if ($LASTEXITCODE -eq 0 -and (Test-Path $launcherPath)) {
                $launcherCompiled = $true
            } else {
                Write-Warning ("启动器编译失败：" + ($launcherOutput -join " "))
            }
        }
        if (-not $launcherCompiled -and (Test-Path $prebuiltLauncher)) {
            Copy-Item $prebuiltLauncher $launcherPath -Force
            $launcherCompiled = $true
            Write-Warning "已使用预编译的按需启动器。"
        }
        if ($launcherCompiled) {
            Write-Host ("已安装按需启动器：" + $launcherPath)
        }
    } else {
        Write-Warning "找不到 launcher\PixivOneDriveLauncher.cs，跳过按需启动器。"
    }

    if (-not $HelperOnly) {
        Write-Step "安装 Edge 扩展文件"
        if (Test-Path $extensionDir) {
            Remove-Item $extensionDir -Recurse -Force
        }
        Copy-Item $extensionSource $extensionDir -Recurse
        Write-Utf8NoBom (Join-Path $extensionDir "config.js") (
            "self.PIXIV_ONEDRIVE_CONFIG = " +
            ([ordered]@{
                endpoint = "http://127.0.0.1:" + $port
                token = $token
            } | ConvertTo-Json -Compress) +
            ";`r`n"
        )
    } else {
        Write-Step "跳过扩展文件（-HelperOnly）"
    }

    Write-Step "写入配置"
    $configObject = [ordered]@{
        port = $port
        token = $token
        downloadDir = $DownloadDir
        maxConcurrentJobs = 2
        idleExitMinutes = $IdleExitMinutes
    }
    Write-Utf8NoBom $configPath ($configObject | ConvertTo-Json -Depth 4)

    Write-Step "注册按需拉起（Native Messaging）"
    $nativeHostName = "com.kuenice.pixiv_onedrive_launcher"
    $nativeHostManifestPath = Join-Path $installDir ($nativeHostName + ".json")
    $extensionId = "fiikgpfcmommnnfahgnikomdkfohkcdn"
    $extensionManifestPath = Join-Path $extensionSource "manifest.json"
    if (Test-Path $extensionManifestPath) {
        try {
            $extensionManifest = Get-Content $extensionManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($extensionManifest.key) {
                $computedId = Get-ExtensionIdFromKey $extensionManifest.key
                if ($computedId) {
                    $extensionId = $computedId
                }
            }
        } catch {
            Write-Warning ("读取扩展 manifest 失败：" + $_.Exception.Message)
        }
    }
    if (Test-Path $launcherPath) {
        $nativeHostManifest = [ordered]@{
            name = $nativeHostName
            description = "Pixiv OneDrive helper launcher"
            path = $launcherPath
            type = "stdio"
            allowed_origins = @("chrome-extension://" + $extensionId + "/")
        }
        Write-Utf8NoBom $nativeHostManifestPath ($nativeHostManifest | ConvertTo-Json -Depth 5)
        $nativeHostRegPath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\" + $nativeHostName
        New-Item -Path $nativeHostRegPath -Force | Out-Null
        Set-Item -Path $nativeHostRegPath -Value $nativeHostManifestPath
        Write-Host ("已注册本地宿主：" + $nativeHostName)
        Write-Host ("  程序：" + $launcherPath)
        Write-Host ("  允许来源：chrome-extension://" + $extensionId + "/")
    } else {
        Write-Warning "启动器不存在，跳过 Native Messaging 注册。"
    }

    Write-Step "注册开机自启动"
    $startupDir = [Environment]::GetFolderPath("Startup")
    $shortcutPath = Join-Path $startupDir "PixivOneDriveHelper.lnk"
    if ($NoStartup -or $OnDemand) {
        if (Test-Path $shortcutPath) {
            Remove-Item $shortcutPath -Force
        }
        if ($OnDemand) {
            Write-Host "已切换为按需启动：删除开机自启动，改由扩展在需要时拉起。"
        } else {
            Write-Host "已跳过开机自启动（-NoStartup）。"
        }
    } else {
        try {
            $shell = New-Object -ComObject WScript.Shell
            $shortcut = $shell.CreateShortcut($shortcutPath)
            $shortcut.TargetPath = $exePath
            $shortcut.WorkingDirectory = $installDir
            $shortcut.WindowStyle = 7
            $shortcut.Description = "Pixiv 收藏原图 -> OneDrive 本地助手"
            $shortcut.Save()
            Write-Host ("已创建启动快捷方式：" + $shortcutPath)
        } catch {
            Write-Warning ("创建开机自启动失败：" + $_.Exception.Message)
        }
    }

    Write-Step "启动本地助手"
    Start-Process -FilePath $exePath -WorkingDirectory $installDir -WindowStyle Hidden

    $healthy = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 250
        try {
            $health = Invoke-RestMethod `
                -Uri ("http://127.0.0.1:" + $port + "/health") `
                -Headers @{ "X-Pixiv-Token" = $token } `
                -TimeoutSec 2
            if ($health.ok) {
                $healthy = $true
                break
            }
        } catch {
            # 助手可能仍在启动。
        }
    }

    if (-not $healthy) {
        Write-Warning "本地助手没有响应，请查看日志：$installDir\helper.log"
        $logPath = Join-Path $installDir "helper.log"
        if (Test-Path $logPath) {
            Write-Host "--- 日志末尾 ---"
            Get-Content $logPath -Encoding UTF8 -Tail 20
        }
    } else {
        Write-Host ("本地助手运行正常（端口 " + $port + "）。")
    }

    if (-not $NoOpen -and -not $HelperOnly) {
        $edgeCandidates = @(
            (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
            (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe")
        )
        $edge = $edgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
        if ($edge) {
            Start-Process -FilePath $edge -ArgumentList "edge://extensions/"
        }
        Start-Process explorer.exe $extensionDir
    }

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host " 安装完成" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host (" 保存目录 : " + $DownloadDir)
    if (-not $HelperOnly) {
        Write-Host (" 扩展目录 : " + $extensionDir)
    }
    Write-Host (" 助手日志 : " + (Join-Path $installDir "helper.log"))
    Write-Host (" 启动器   : " + $launcherPath)
    Write-Host (" 启动器日志: " + (Join-Path $installDir "launcher.log"))
    Write-Host (" 令牌文件 : " + $configPath)
    Write-Host (" 启动方式 : " + $(if ($OnDemand) { "按需拉起（扩展触发）" } else { "开机自启动" }))
    Write-Host (" 空闲退出 : " + $(if ($IdleExitMinutes -gt 0) { $IdleExitMinutes.ToString() + " 分钟" } else { "关闭" }))
    Write-Host ""

    if ($HelperOnly) {
        $copied = $false
        try {
            Set-Clipboard -Value $token -ErrorAction Stop
            $copied = $true
        } catch {
            Write-Warning ("无法复制令牌到剪贴板：" + $_.Exception.Message)
        }

        Write-Host " 商店版扩展配置：" -ForegroundColor Yellow
        Write-Host "   1. 在 Edge 加载项商店安装扩展"
        Write-Host "   2. 打开扩展的“本地助手设置”"
        Write-Host "   3. 助手地址保持默认，粘贴访问令牌"
        if ($copied) {
            Write-Host "      访问令牌已复制到剪贴板，可直接粘贴。" -ForegroundColor Green
        } else {
            Write-Host ("      访问令牌在：" + $configPath)
        }
        Write-Host ""
    } else {
        Write-Host " 最后一步（只需做一次）：" -ForegroundColor Yellow
        Write-Host "   1. 在打开的 Edge 扩展页启用“开发人员模式”"
        Write-Host "   2. 点击“加载解压缩的扩展”"
        Write-Host ("      选择：" + $extensionDir)
        Write-Host "   3. 把扩展固定到工具栏，然后去 pixiv 收藏作品"
        Write-Host ""
    }

    if ($OnDemand) {
        Write-Host " 按需启动提示：" -ForegroundColor Yellow
        Write-Host "   1. 在 edge://extensions 里先移除已安装的旧版同名扩展"
        Write-Host "   2. 再点“加载解压缩的扩展”，选择上面的扩展目录"
        Write-Host "   3. 之后打开插件面板或收藏作品，助手才会被拉起"
        Write-Host ""
    }

    if (-not $healthy) {
        Write-Host " 注意：本地助手当前未响应，请先查看日志。" -ForegroundColor Red
    }
    Write-Host "============================================================" -ForegroundColor Green

    if (-not $healthy) {
        exit 1
    }
} catch {
    Write-Host ""
    Write-Host ("安装失败：" + $_.Exception.Message) -ForegroundColor Red
    Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray
    exit 1
}
