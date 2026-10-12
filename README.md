# OpenCode Model Fallback – lokaler v2-Draft

Wartungsbasis für den lokal angepassten Modell-Fallback unter OpenCode **2.0.25**. Noch kein eigenständiges Releaseprojekt.

Der native v2-Einstieg (`server.js` → `src/v2.ts`, gebaut als `dist/server.js`) wechselt bei Limits das Modell derselben Child-Session. Rollenbezogene Ketten erhalten Varianten und optionale HTTP-`request.body`-Overrides. Parent, Agent und Berechtigungen bleiben unverändert. Seit der Erweiterung begrenzt `maxCycles` (Deployments: `5`) die Kettenumdrehungen pro Child-Session: nach dem ersten Vorwärtsdurchlauf kehrt der Fallback vom letzten Modell zum frühesten abgekühlten verfügbaren Modell zurück, höchstens jedoch fünf Durchläufe gesamt; ohne Kandidat stoppt das Kind sofort (Details: `docs/maintenance.md`). Legacy-Code und Tests sind weiterhin enthalten.

## Entwicklung

```sh
bun install --frozen-lockfile --ignore-scripts
bun test
bun run typecheck
bun run build
bun run test:v2:integration
```

Der Integrationstest startet einen privaten OpenCode-Server mit lokalen, ausdrücklich bezeichneten Testdaten; keine bezahlten Provideraufrufe. Er benötigt OpenCode 2.0.25 und Python 3.

## Stand und Herkunft

Basis: [Smart-Coders-HQ/opencode-model-fallback](https://github.com/Smart-Coders-HQ/opencode-model-fallback), Commit `4920240fb95c48b42f8d9e9d7648aa473740afe0`, Apache-2.0 (siehe `LICENSE`). Native v2-Anpassungen wurden lokal ergänzt.

Die aktive Installation bleibt vorerst unter `~/.config/opencode/local-plugins/model-fallback`. Dieses Repo ist eine separate Wartungskopie; Änderungen werden **nicht automatisch aktiviert**.

Kurznotizen: [docs/maintenance.md](docs/maintenance.md).
