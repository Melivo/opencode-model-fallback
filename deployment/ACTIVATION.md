# Lokaler v2-Fork: Aktivierung und Nachweise

**Aktiviert und verifiziert.** Der lokale Verzeichnis-Eintrag wurde an das globale `plugins`-Array angehängt und `opencode reload` ausgeführt. Die Live-API `/api/plugin` bestätigt `smart-coders.model-fallback.v2-local` mit `state.status: active` und dem lokalen `server.js`-Pfad. Die übergeordnete Instanz hat alle 179 Tests, Typecheck und die private v2-Integration erneut erfolgreich ausgeführt; alle 48 Agentdateien sind laut Quellhash unverändert.

## Dauerhafte Artefakte

Basisverzeichnis: `/home/visimeos/.config/opencode/local-plugins/model-fallback`

- `server.js`: v2-Verzeichnis-Einstieg; exportiert `dist/server.js`.
- `dist/server.js`: gebauter v2-Plugin-Code, SDK `@opencode/plugin@2.0.25` wird vom Host bereitgestellt.
- `deployment/model-fallback.v2.json`: exakt 12 Rollen mit jeweils Primärmodell und drei Fallbackschritten; aus den bestehenden 48 Agentdateien abgeleitet.
- `deployment/agent-source-sha256.json`: Quellhashes zur Prüfung unveränderter Prompts/Berechtigungen.
- `deployment/activation.snippet.json`: einzufügender Plugin-Eintrag.
- `src/v2.ts`: v2-Implementierung. Legacy-Code und seine Tests bleiben separat erhalten.

## Aktivierung durch die übergeordnete Instanz

1. Den Objekt-Eintrag aus `activation.snippet.json` **an das bestehende `plugins`-Array anhängen**, nicht die gesamte Konfiguration ersetzen:

```json
{
  "package": "/home/visimeos/.config/opencode/local-plugins/model-fallback",
  "options": {
    "configPath": "/home/visimeos/.config/opencode/local-plugins/model-fallback/deployment/model-fallback.v2.json"
  }
}
```

2. Nur bei bestätigter Aktivierung `opencode reload` ausführen.
3. Im betreffenden Arbeitsverzeichnis `opencode plugin list` bzw. die v2-Plugin-API lesen: `smart-coders.model-fallback.v2-local` muss aktiv sein und auf das obige lokale `server.js` zeigen. Katalogprüfung kostet keinen Modellaufruf.
4. Rücknahme: ausschließlich diesen Plugin-Eintrag entfernen und nach Freigabe neu laden. Agentdateien und Berechtigungen bleiben unverändert.

**Keinen einzelnen Dateipfad in `plugins` konfigurieren:** v2 erwartet für explizite lokale Plugins ein Verzeichnis und sucht dort nach `server.js`. `dist/index.js` ist der Legacy-Einstieg und hier nicht zu verwenden.

## Nachgewiesene Prüfung

```sh
cd /home/visimeos/.config/opencode/local-plugins/model-fallback
bun install --ignore-scripts
bun test
bun run typecheck
bun run build
bun run test:v2:integration
```

- `evidence/all-tests.log`: 179 pass, 0 fail, 511 Assertions, 19 Dateien; beinhaltet 168 unveränderte Upstreamtests.
- `evidence/01-red-parser.log` bis `evidence/16-green-default-variant.log`: echte RED/GREEN-Nachweise.
- `evidence/typecheck.log`, `evidence/build.log`: erfolgreiche Gates, Deklarationen und Bundle gebaut.
- `evidence/v2-integration-result.json`: echter OpenCode-v2.0.25-Prozess; drei erfolgreich abgeschlossene Child-Jobs, automatische Parent-Fortsetzung, unverändertes Parent-Modell/-Agent.
- `evidence/v2-provider-requests.json`: eindeutig bezeichnete deterministische **TESTDATEN**, lokale SSE-Fixtures. Primärmodell einmal mit HTTP 429; Fallback1 dreimal, davon einmal 429; Fallback2 einmal erfolgreich. Exakte Varianten und Body-Override auf Fallback1, kein Thinking-Override auf Fallback2.
- `evidence/v2-isolated-sources.json`: tatsächliche Konfigurationsquellen des privaten Servers; keine Live-Konfigurationsquelle.
- `evidence/v2-plugin-inventory.json`: Plugin aktiv ausschließlich im privaten Testserver.
- `evidence/v2-parent-messages.json`, `evidence/v2-sessions.json`, `evidence/v2-native-runtime.log`: reale Testsession-/Job-/Laufzeitnachweise.
- `evidence/live-catalog-check.json`: read-only Live-Katalogprüfung sämtlicher 48 Referenzen; keine fehlenden Modelle oder Varianten.

## Verhalten und Grenzen

Nur konfigurierte Basisrollen in `mode: subagent` **und** mit Parent-Session sind betroffen. Keine Wildcards, kein Fallback für Primary-/Root-Sessions. Der Agent wird nie gewechselt: ursprünglicher Prompt und Berechtigungen bleiben wirksam. Die Fallbackdateien liefern Modell, Variante und optional `request.body`, nicht neue Prompts/Berechtigungen.

Der v2-Retry-Hook wechselt das Modell derselben laufenden Child-Session und setzt die Retry-Verzögerung auf null. Der native Job bleibt Eigentümer des Ergebnisses. Kein Abort/Revert/Prompt-Replay. Bereits bekannte Ausfälle werden im Prompt-Hook übersprungen; Erschöpfung beendet weitere Retries. Health ist pro Plugin-/Location-Instanz geteilt und wird beim Neustart verworfen; keine automatische Rückkehr mitten in einer Session.

**Begrenzte Zyklen (`maxCycles: 5`):** Pro Child-Session werden höchstens fünf Ketten-Durchläufe genutzt — der erste Vorwärtsdurchlauf ist Pass 1, jede Rückkehr vom letzten Kettenmodell zum frühesten abgekühlten verfügbaren Modell (Standard-Wrap kehrt zum Kettenanfang zurück) erhöht den Pass. Das Budget gilt pro `sessionID` über die Plugin-Lebensdauer und wird durch Retries, Prompt-Hooks oder ablaufende Cooldowns nie aufgefüllt; ein neues Child startet immer bei Pass 1. Ist kein Kandidat bereit (alle im Cooldown, Modell/Variante nicht im Katalog), stoppt das Kind sofort mit `retry:false`, ohne auf Cooldown-Ablauf zu warten. Ein veralteter Retry (`attempt` nicht höher als der zuletzt behandelte, oder Modell ungleich aktuellem Kettenindex) wird verworfen und kann das Child nie rückwärts bewegen; ein erfolgreicher Primär-Response hebt nur den Attempt-Zaun, nie das Budget. Semantik-Details: `docs/maintenance.md` im Wartungsrepo.

Body-Overrides werden pro Schritt erst auf die fertig gebaute HTTP-Anfrage tief gemischt. Das ist **kein** mutierter globaler Providerzustand. Docs-curator behält exakt `kimi-code-plan-cn/kimi-for-coding#high` mit `thinking.type: disabled`. Die vorhandenen zwölf Ketten verwenden Varianten unverändert.

Reale bezahlte Provideraufrufe und die Gültigkeit gespeicherter Zugangsdaten wurden absichtlich nicht getestet. Die Katalogprüfung ist kein Authentifizierungsnachweis. Der HTTP-Override-Pfad ist getestet; WebSocket-Frame-Overrides sind nicht implementiert (bei zukünftigen Override-Schritten mit WebSocket-Transport vorher separat prüfen). Nicht-JSON-HTTP-Bodies sind nicht unterstützt. Legacy-Toast-/Statuswerkzeuge gehören nicht zum separaten v2-Einstieg.

Upstream: `https://github.com/Smart-Coders-HQ/opencode-model-fallback`, SHA `4920240fb95c48b42f8d9e9d7648aa473740afe0`.
V2-Verträge geprüft gegen `anomalyco/opencode` Tag `v2.0.25` (`b44eea9e204024db2b480a136ece29d790d5f593`), insbesondere `packages/plugin/src/promise/session.ts`, `packages/core/src/session/runner/llm.ts`, `packages/core/src/config/plugin/source.ts`, sowie den realen installierten v2-OpenAPI-Vertrag.
