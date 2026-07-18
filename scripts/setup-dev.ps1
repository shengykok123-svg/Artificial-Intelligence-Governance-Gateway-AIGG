$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot ".env"
$backendPython = Join-Path $repoRoot "backend\.venv\Scripts\python.exe"

if (-not (Test-Path $backendPython)) {
  Write-Host "backend .venv was not found. Creating it and installing requirements..."
  py -3.11 -m venv (Join-Path $repoRoot "backend\.venv")
  & $backendPython -m pip install -r (Join-Path $repoRoot "backend\requirements.txt")
}

$fernetKey = & $backendPython -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

@"
DATABASE_URL=postgresql+psycopg://gateway:gateway@localhost:5432/gateway
REPO_BACKEND=memory
TEST_DATABASE_URL=postgresql+psycopg://gateway:gateway@localhost:5432/postgres
MOCK_MODULES=M3
ENV=dev
API_KEY=dev-key-change-me
VAULT_FERNET_KEY=$fernetKey
"@ | Set-Content -Path $envPath -Encoding UTF8

Write-Host "Wrote local .env with MOCK_MODULES=M3 and a generated VAULT_FERNET_KEY."
Write-Host "Start backend with:"
Write-Host "  cd `"$repoRoot\backend`""
Write-Host "  .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
