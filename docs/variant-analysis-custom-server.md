# Custom variant analysis server (internal)

> [!WARNING]
> **Internal and unsupported.** This is not a public feature. The settings below are not declared in
> `package.json`, do not appear in the Settings UI, and may change or be removed without notice.
> Do not document them in user-facing docs or the changelog.

By default, multi-repository variant analysis (MRVA) uses the GitHub REST API and the user's GitHub sign-in.
An organization can instead send variant analyses to its own server. That server must implement the
GitHub variant analysis REST endpoints and authenticate requests with a bearer token. A separate
extension, owned by the organization, supplies the token.

## Settings

Both settings are only read from **user** or **machine** (remote) settings. Workspace and folder values are ignored,
so a repository cannot redirect queries or tokens.

| Setting | Value |
| --- | --- |
| `codeQL.variantAnalysis.serverUrl` | Base URL of the server. Must be `https:` and must not contain credentials. A trailing `/` is removed. |
| `codeQL.variantAnalysis.serverTokenProvider` | ID (`publisher.name`) of the installed extension that provides the token. |

If `serverUrl` is set but invalid, variant analysis fails instead of falling back to GitHub.
Query strings and fragments are rejected; base path prefixes are supported.
The hidden server setting is the opt-in switch; there is no additional canary gate.

## Token provider extension

The extension named in `serverTokenProvider` must return the following from `activate()`:

```ts
export interface VariantAnalysisServerTokenProvider {
  getVariantAnalysisServerToken(serverUrl: string): Promise<string | undefined>;
}
```

CodeQL activates the extension if it isn't already running, and calls `getVariantAnalysisServerToken`
before every request. The provider is responsible for caching and refreshing the token. It should return
`undefined` if no token is available, so that CodeQL can show a clear error instead of sending an
unauthenticated request. The token is never logged.

Only the extension that the user or administrator names is called. Extensions cannot register
themselves as providers.

## Behavior when a server is configured

- MRVA is enabled regardless of `github-enterprise.uri`. The GitHub sign-in, GitHub database
  downloads and other extensions that read `github-enterprise.uri` are not affected.
- No controller repository is needed. Requests use controller repository ID `0`.
- Runs retain their originating server URL. Polling, task retrieval and cancellation fail if
  the current server setting differs. Restore the original setting to resume them. Legacy runs
  without a server URL are treated as GitHub runs.
- The GitHub token is never sent to the server, and results are never uploaded to GitHub:
  "Export to gist" and "View logs" (GitHub Actions) are unavailable.
- Result artifacts are downloaded from `artifact_url` without authentication, as on GitHub.
- If a repository task has no `database_commit_sha`, file links point to `HEAD`.
  These links may not match the analyzed revision.
- The canary-only autofix action still downloads repository source through GitHub sign-in.
  It requires the analyzed repository and revision to be available on the configured GitHub host.
  Custom source retrieval is not supported.

## Server contract

All paths are relative to `serverUrl`. Requests send `Authorization: Bearer <token>` and JSON bodies.
Redirects are rejected rather than forwarding query packs to another endpoint.
Request and response shapes match `src/variant-analysis/gh-api/variant-analysis.ts`.

| Operation | Request |
| --- | --- |
| Submit | `POST /repositories/0/code-scanning/codeql/variant-analyses` |
| Get status | `GET /repositories/0/code-scanning/codeql/variant-analyses/{id}` |
| Get repository task | `GET /repositories/0/code-scanning/codeql/variant-analyses/{id}/repositories/{repoId}` |
| Cancel | `POST /repos/{controller_repo.full_name}/actions/runs/{actions_workflow_run_id}/cancel` |

Variant analysis responses must include `controller_repo` and, for cancellation to work,
`actions_workflow_run_id`. Errors should be returned as non-2xx responses with a JSON body
`{ "message": "..." }`. CodeQL shows the status and that message to the user.

## Running CodeQL in a remote workspace

To run the CodeQL extension on the remote machine alongside the token provider, set the VS Code
setting `remote.extensionKind` to `{ "github.vscode-codeql": ["workspace"] }`. No change to the
extension is needed.
