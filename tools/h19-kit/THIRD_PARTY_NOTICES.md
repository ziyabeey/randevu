# Third-party integration policy

This incubator currently bundles **no third-party source code** from the projects below.

The projects are architectural references or optional external integrations. Before any future vendoring or
package dependency is added, the exact release/tag license must be pinned and reviewed.

| Project/family | Intended use | Integration policy |
|---|---|---|
| Tornhill-style rule cards | versioned evidence/rule contracts | idea reimplemented in H19 code |
| pytest-testmon | test-impact memory | adapter; do not assume Python-only implementation |
| Semgrep | deterministic static facts | external CLI / JSON bridge; do not bundle community rules |
| PIT / Stryker | mutation registry + history | architecture inspiration; H19 mutators are our own |
| PR-Agent | token-aware context packing | clean reimplementation, no copied source |
| Code Maat | temporal coupling | H19 implementation from git history; no GPL code linked |
| ctxwitch | behavioral dimensions / unresolved state | architecture inspiration |
| reviewdog / SARIF ecosystem | standardized diagnostics | emit standard formats; optional external reporter |

## Rule

A third-party project's **idea or public interface pattern** may inspire an independent H19 implementation.
Third-party source code is only copied, modified, linked or redistributed after an exact-version license review.
