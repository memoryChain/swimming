# Repository Codex Skills

The folders in this directory are the repository-owned source of truth. Do not maintain installed copies under `%USERPROFILE%\.codex\skills` directly.

Install or update the skills on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File tools/install-codex-skills.ps1
```

Preview changes without writing:

```powershell
powershell -ExecutionPolicy Bypass -File tools/install-codex-skills.ps1 -WhatIf
```

Restart Codex after installing so a new session discovers the updated skill metadata and resources.
