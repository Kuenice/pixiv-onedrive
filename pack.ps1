[CmdletBinding()]
param(
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$extensionDir = Join-Path $root "extension"
$distDir = Join-Path $root "dist"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$manifestPath = Join-Path $extensionDir "manifest.json"
if (-not (Test-Path $manifestPath)) {
    throw "Missing extension\manifest.json"
}

$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = [string]$manifest.version
}

New-Item -ItemType Directory -Force -Path $distDir | Out-Null

function New-Package {
    param(
        [string]$Label,
        [switch]$StripKey
    )

    $temp = Join-Path ([System.IO.Path]::GetTempPath()) ("pixiv-pack-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $temp | Out-Null
    try {
        Copy-Item (Join-Path $extensionDir "*") $temp -Recurse -Force
        Remove-Item (Join-Path $temp "_metadata") -Recurse -Force -ErrorAction SilentlyContinue
        Get-ChildItem $temp -Recurse -File | Where-Object { $_.Name -like "*.bak*" } | Remove-Item -Force

        $packed = Get-Content (Join-Path $temp "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($StripKey) {
            $packed.PSObject.Properties.Remove("key")
        }

        # Windows PowerShell 5.1 escapes non-ASCII as \uXXXX, which is still
        # valid JSON and keeps the package ASCII-only. PowerShell 7 keeps the
        # characters readable. Both are fine for Edge.
        $json = $packed | ConvertTo-Json -Depth 10
        [System.IO.File]::WriteAllText((Join-Path $temp "manifest.json"), $json + "`r`n", $utf8NoBom)

        $zip = Join-Path $distDir ("PixivOneDrive-" + $Label + "-" + $Version + ".zip")
        if (Test-Path $zip) {
            Remove-Item $zip -Force
        }
        Compress-Archive -Path (Join-Path $temp "*") -DestinationPath $zip -CompressionLevel Optimal
        return $zip
    } finally {
        Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function New-InstallerPackage {
    $temp = Join-Path ([System.IO.Path]::GetTempPath()) ("pixiv-full-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $temp | Out-Null
    try {
        foreach ($item in @(
            "README.md", "PRIVACY.md",
            "Install.cmd", "Install-Helper.cmd", "Switch-ToOnDemand.cmd",
            "install.ps1", "uninstall.ps1", "status.ps1"
        )) {
            $source = Join-Path $root $item
            if (Test-Path $source) {
                Copy-Item $source $temp -Force
            } else {
                Write-Warning ("Missing " + $item)
            }
        }

        foreach ($dir in @("extension", "helper", "launcher")) {
            $source = Join-Path $root $dir
            if (Test-Path $source) {
                Copy-Item $source (Join-Path $temp $dir) -Recurse -Force
            }
        }

        Get-ChildItem $temp -Recurse -File | Where-Object { $_.Name -like "*.bak*" } | Remove-Item -Force

        $zip = Join-Path $distDir "PixivOneDrive.zip"
        if (Test-Path $zip) {
            Remove-Item $zip -Force
        }
        Compress-Archive -Path (Join-Path $temp "*") -DestinationPath $zip -CompressionLevel Optimal
        return $zip
    } finally {
        Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$devZip = New-Package -Label "dev"
$storeZip = New-Package -Label "store" -StripKey
$installerZip = New-InstallerPackage

Write-Host ""
Write-Host ("Version      : " + $Version)
Write-Host ("Dev package  : " + $devZip)
Write-Host "               keeps `"key`"; loads as unpacked, ID stays stable"
Write-Host ("Store package: " + $storeZip)
Write-Host "               key removed; upload this one to Edge Add-ons"
Write-Host ("Installer pkg: " + $installerZip)
Write-Host "               full package for the GitHub release (Install.cmd etc.)"
Write-Host ""
Write-Host "Publishing checklist:"
Write-Host "  1. Bump extension\manifest.json version before packing"
Write-Host "  2. Mention the new nativeMessaging permission in the update notes"
Write-Host "  3. Keep allowed_origins in the native host manifest on the store ID"
