# Wartungsnotizen (Draft)

## Aktuelle v2-Konfiguration und Wartung

- `deployment/model-fallback.v2.json` ist die vollständige neutrale Vorlage: `version: 2`, `cooldownMs: 300000`, `maxCycles: 1`, `agents: {}`. Sie ist ein gültiger No-op, nicht eine vorbefüllte Liste persönlicher Rollen.
- `examples/model-fallback.v2.json` zeigt separat eine konfigurierte generische Beispielkette. Die Beispielwerte sind keine zugesicherten Provider oder Modelle.
- `src/v2.ts` lädt eine explizite Konfiguration über `config` oder `configPath`; fehlt beides, gilt die neutrale Runtime-Defaultkonfiguration.
- `scripts/derive-v2-config.ts` validiert Konfigurationen. `bun run check:v2` prüft die neutrale Vorlage ohne Home-Agentdateien. Pfadbezogene Operationen brauchen explizit sowohl Configdatei als auch Agentverzeichnis.
- `deployment/base-agent-sha256.json` ist ein historisches Hashmanifest. Es wird beibehalten, ist keine Laufzeitabhängigkeit und belegt keine aktuelle Agentprofil-Autorität.

### Vorlage sicher einrichten und syncen

1. Nach Installation des Pakets die neutrale Vorlage aus `deployment/model-fallback.v2.json` im installierten Paket in den OpenCode-Konfigurationsordner kopieren: `$XDG_CONFIG_HOME/opencode` oder andernfalls `~/.config/opencode`. Nur in eine noch nicht vorhandene Zieldatei kopieren; bestehende Dateien niemals ersetzen. Die Installation selbst erzeugt oder ändert keine Home-Konfigurationsdateien und installiert keine Agentprofile.
2. Für explizite vorhandene Subagenten müssen Nutzer selbst exakte, verfügbare Provider-/Model-Referenzen ergänzen. Jede Kette hat 2–10 Schritte einschließlich Startmodell und Fallback.
3. `bun run check:v2` nutzt die versionierte neutrale Vorlage und liest keine persönlichen Agentdateien. Für gezielte Prüfung: `bun scripts/derive-v2-config.ts --check <config.json> <agents-dir>`. Eine explizite Synchronisierung erfolgt ausschließlich mit `bun scripts/derive-v2-config.ts --sync-base <config.json> <agents-dir>`; sie prüft und aktualisiert nur das Modellfeld der passenden Agentdateien im angegebenen Verzeichnis. Kein impliziter Home-Sync.
4. Tests verwenden kurze generische Fixtures und private Testdaten statt persönlicher Profile. Die [README-Setupanleitung](../README.md#opencode-v2-installation-and-configuration) beschreibt das portable Verbraucher-Setup.

Frühere Rollenlisten, lokale Modellketten, Homepfade und Sync-/Integrationsnachweise sind historisch; sie bleiben als damalige Evidenz erhalten, sind aber kein aktueller Vertrag für das neutrale Setup.

## Begrenztes zyklisches Fallback (maxCycles)

`maxCycles` (Integer 1–5, fehlt ⇒ sicherer Default `1` = bisheriges Verhalten ohne Wrap) begrenzt die **Kettenumdrehungen pro Child-Session**: Der erste Vorwärtsdurchlauf ist Pass 1; ein Wechsel vom letzten Kettenmodell zurück zu einem früheren ist Pass 2 usw. Mit `maxCycles: 5` werden also höchstens fünf Durchläufe genutzt — der sechste wird blockiert, selbst wenn zwischenzeitlich Cooldowns abgelaufen sind. Ein Budget wird beim Umdrehen verbraucht, nicht pro Retry: Wechsel a→b innerhalb desselben Durchlaufs zählt nicht zusätzlich. Der Vorwärtsdurchlauf endet am letzten Modell; zurück geht es nur per Umdrehung zum frühesten abgekühlten verfügbaren Modell (Standard-Wrap kehrt zum ersten Modell der Kette zurück, wenn verfügbar).

Verbrauch/Stop:

- Zustand ist pro `sessionID` (Index, Pass, stopped) über die Plugin-Lebensdauer; Retries und Prompt-Hooks replenishieren das Budget nie.
- Ein neues Child startet immer bei Pass 1, auch mitten in einer Kette (Preemptiv-Umleitung verbraucht keinen Pass).
- Wenn kein Kandidat bereit ist (alle im Cooldown, Katalog/variante fehlt), stoppt das Kind sofort `retry:false` — kein Warten auf Cooldown-Ablauf, kein Durchlauf-„Verschwenden".
- Nach endgültigem Stop bleiben spätere Retries/Prompts dieses Childs gestoppt, bis zur Abgabe des Plugin-Handlers (Dispose).

Stale-Schutz: Native `attempt`-Nummern starten pro logischem Schritt neu. Ein Retry-Event wird verworfen, wenn `attempt` nicht strikt über dem zuletzt behandelten steht; ein erfolgreicher primärer `http.response` (200) des Childs hebt nur diesen Zaun — nie das Pass-Budget. Ein veralteter Retry für ein früheres Modell kann das Child nie rückwärts bewegen, auch nicht nach Wrap.

Pfadbezogene Wartungsbefehle bearbeiten ausschließlich die ausdrücklich übergebenen Config- und Agentverzeichnisse; es gibt keinen impliziten Home-Sync. `--sync-base` aktualisiert ausschließlich Modellfelder im angegebenen Agentverzeichnis, niemals Konfigurationsketten. Diese Kopie wurde nicht erneut gegen reale Provider authentifiziert.

## Historische General-/Claude-Streamlimit-Details

Die folgenden konkreten General- und docs-curator-Modellketten beschreiben einen früheren lokalen Stand. Sie sind weder Runtime-Default noch aktuelle Autorität für persönliche Agentprofile; das heutige neutrale Setup enthält keine vorkonfigurierten Modellketten. Die damaligen Ablauf- und Testbeobachtungen bleiben als historische Evidenz erhalten.

Die frühere General-Kette war Opus 5.5 → GLM 5.3 → Kimi K3.1 Pro → Sol 6.1, jeweils `low` (exakte Referenzen in der damaligen JSON). General erhielt sein Startmodell per `ctx.agent.transform` nur im effektiven Subagentmodus. Eine `general.md` wurde dafür nicht erzeugt. Thinking-off galt nur für den damaligen docs-curator/Kimi-Schritt.

Der native Retrypfad normalisiert das ursprüngliche Claude-1.7-SSE-Envelope begrenzt und deterministisch. `provider.internal` oder `server_error` allein ist keine Quota. Der Integrationstest verwendet dieselbe native `@opencode/ai/providers/openai-compatible`-Implementierung wie Live-Claude, aber nur lokale HTTP200-SSE-Testdaten; ein privater Observer prüft den unveränderten Code `claude_session_limit` in `error.response.body` vor Normalisierung. Dies ist kein Claude-/Account-E2E-Test.

`bun run test:v2:integration` prüft vor jedem Prompt die tatsächliche Isolation und führt Altintegration sowie vier private builtin-general-Szenarien aus. General hat vier low-Schritte, Erfolg auf Sol, Erschöpfung nach Sol, sofortigen All-Cooldown-Stop und maximal fünf Pässe. Request-/Retry-Session, einmaliger nativer Subagent-Toolauftrag und Parentfortsetzung belegen dieselbe Child-Ausführung ohne Replay. Umschalt-Overhead muss unter fünf Sekunden bleiben; nur Zyklusfixtures enthalten separate 12.2s Providerlatenz. Die Fünfpassfixture enthält vier erfolgreiche native Read-Zwischenschritte auf privaten Testdaten im selben Child: Sie setzen OpenCodes harten Zehn-Retry-Zähler pro logischem Schritt zurück, aber ausdrücklich nicht das Plugin-Passbudget. Stale-Events werden ausschließlich durch Units belegt. Standardausgaben: `evidence/general-stream-limit/T02-native/`; `--evidence-dir` erlaubt einen separaten Zielpfad.

## Historischer Ausgangsstand

OpenCode 2.0.25; 179 Tests bestanden, Typecheck und Build erfolgreich. Privater Integrationstest bestätigte drei abgeschlossene Child-Jobs, Parent-Fortsetzung, Varianten und isolierte Overrides. Die aktive Installation wurde separat geladen und als `smart-coders.model-fallback.v2-local` bestätigt.

## Grenzen und spätere Arbeit

- Nur konfigurierte Child-Subagents, keine Primary-/Wildcard-Ketten.
- HTTP-JSON-Overrides unterstützt; WebSocket-Frame-Overrides nicht implementiert.
- Bestehende Legacy-Status-/Toast-Funktionen gehören nicht zum v2-Einstieg.
- Vor einem OpenCode-Upgrade erneut Typecheck und privaten Integrationstest ausführen.
- Die portable Paketinstallation und Beispielkonfiguration stehen in [README.md](../README.md); Releasebootstrap, Freigaben und Recovery stehen in [docs/releases.md](releases.md). Das Paket ist vorbereitet, aber noch nicht auf npm veröffentlicht.

Die bestehende lokale Deploymentinstallation wurde durch diese Paket-/Releaseänderung nicht automatisch aktiviert oder neu geladen. Ihre Aktivierung/Rücknahme ist in `deployment/ACTIVATION.md` dokumentiert.
