<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Local Workflow

- Do not run `npm`/Node.js project commands inside WSL when a PowerShell/Windows run is viable. Prefer `powershell.exe` for commands like `npm run dev`, `npm run build`, `npm install`, and other package-manager tasks because WSL is too slow for this repo.
- When frontend code changes, start the dev server via PowerShell if it is not already running.
- After frontend changes, verify the result yourself as much as the environment allows. At minimum, check that the dev server starts cleanly and the app loads. If full browser interaction is not available, state that limit clearly and still perform the reachable checks.
