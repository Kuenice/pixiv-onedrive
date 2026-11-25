[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$installDir = Join-Path $env:LOCALAPPDATA "PixivOneDrive"
$configPath = Join-Path $installDir "config.json"
$logPath = Join-Path $installDir "helper.log"

if (-not (Test-Path $configPath)) {
    Write-Host "还没有安装。请先运行 install.ps1。" -ForegroundColor Yellow
    exit 0
}

$config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$baseUrl = "http://127.0.0.1:" + $config.port

Write-Host "Pixiv 收藏原图 → OneDrive 状态" -ForegroundColor Cyan
Write-Host ("保存目录 : " + $config.downloadDir)
Write-Host ("本地端口 : " + $config.port)
Write-Host ""

try {
    $health = Invoke-RestMethod `
        -Uri ($baseUrl + "/health") `
        -Headers @{ "X-Pixiv-Token" = [string]$config.token } `
        -TimeoutSec 4

    Write-Host "本地助手 : 运行中" -ForegroundColor Green
    Write-Host ("版本     : " + $health.version)
    Write-Host ("等待队列 : " + $health.queued)
    Write-Host ("正在下载 : " + $health.active)
    Write-Host ("已保存   : " + $health.done)
    Write-Host ("失败     : " + $health.failed)
    Write-Host ("跳过     : " + $health.skipped)
    Write-Host ("运行时间 : " + $health.uptimeSeconds + " 秒")
} catch {
    Write-Host "本地助手 : 未运行或无法连接" -ForegroundColor Red
    Write-Host ("错误     : " + $_.Exception.Message)
    Write-Host "可以运行 install.ps1 重新启动，或直接运行："
    Write-Host ("  " + (Join-Path $installDir "PixivOneDriveHelper.exe"))
}

Write-Host ""
Write-Host "最近的日志：" -ForegroundColor Cyan
if (Test-Path $logPath) {
    Get-Content $logPath -Encoding UTF8 -Tail 20
} else {
    Write-Host "（暂无日志）"
}
