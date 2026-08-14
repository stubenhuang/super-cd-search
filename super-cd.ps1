# Super CD Search - Windows build script (PowerShell)
# Usage: .\super-cd.ps1 <command>   (fresh | win | help)
param(
    [Parameter(Position = 0)]
    [string]$Command = "help"
)

$ErrorActionPreference = "Stop"

function Info($msg) { Write-Host "[INFO] $msg" -ForegroundColor Green }
function Error($msg) { Write-Host "[ERROR] $msg" -ForegroundColor Red; exit 1 }

function Clean {
    Info "Cleaning build artifacts..."
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "out", "release"
}

switch ($Command.ToLower()) {
    "fresh" {
        Clean
        Info "Building app..."
        npm run build
        if ($LASTEXITCODE -ne 0) { Error "Build failed" }
        Info "Starting dev server..."
        npm run dev
    }
    "win" {
        Clean
        Info "Building app..."
        npm run build
        if ($LASTEXITCODE -ne 0) { Error "Build failed" }
        Info "Creating Windows ZIP..."
        npm run dist:win
        if ($LASTEXITCODE -ne 0) { Error "Packaging failed" }
        Info "Done. Output in .\release"
    }
    default {
        Write-Host @"
Super CD Search - Build Script (Windows)

Usage: .\super-cd.ps1 <command>

Commands:
  fresh  Clean + build + start dev server
  win    Clean + build + package as ZIP for Windows
  help   Show this help
"@
    }
}
