[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$installDir = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "PixivOneDrive"))
$expected = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "PixivOneDrive"))
if (-not [string]::Equals($installDir, $expected, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "安装目录校验失败，已中止。"
}

$exePath = Join-Path $installDir "PixivOneDriveHelper.exe"
$shortcutPath = Join-Path ([Environment]::GetFolderPath("Startup")) "PixivOneDriveHelper.lnk"

Write-Host "正在停止本地助手 ..."
$processes = Get-CimInstance Win32_Process -Filter "Name = 'PixivOneDriveHelper.exe'" -ErrorAction SilentlyContinue
foreach ($process in $processes) {
    try {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
        Write-Host ("已停止进程 " + $process.ProcessId)
    } catch {
        Write-Warning ("无法停止进程 " + $process.ProcessId + "：" + $_.Exception.Message)
    }
}

if (Test-Path $shortcutPath) {
    Remove-Item $shortcutPath -Force
    Write-Host "已移除开机自启动快捷方式。"
}

if (Test-Path $installDir) {
    Remove-Item $installDir -Recurse -Force
    Write-Host ("已删除安装目录：" + $installDir)
}

Write-Host ""
Write-Host "本地助手已卸载。OneDrive\pixiv 中已下载的图片不会被删除。" -ForegroundColor Green
Write-Host ""
Write-Host "还需要手动移除 Edge 扩展：" -ForegroundColor Yellow
Write-Host "  1. 打开 edge://extensions/"
Write-Host "  2. 找到“Pixiv 收藏原图 → OneDrive”"
Write-Host "  3. 点击“删除”"
