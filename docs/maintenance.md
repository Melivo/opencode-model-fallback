# Wartungsnotizen (Draft)

## Relevante Dateien

- `src/v2.ts`: native v2-Hooks, Modellauswahl und schrittbezogene HTTP-Body-Overrides.
- `test/v2-*.test.ts`: v2-Regressionsprüfungen.
- `scripts/integration-v2.py`: privater v2-Testserver; Child-Abschluss und Parent-Fortsetzung.
- `deployment/model-fallback.v2.json`: einzige Autorität für zwölf Rollen, komplette geordnete Modellschritte, Varianten, Overrides und Limits.
- `scripts/derive-v2-config.ts`: historischer Name; validiert JSON und prüft Basismodelle read-only. `--sync-base` ist die ausdrücklich schreibende Ausnahme und projiziert nur Modellzeilen. Keine Ableitung vollständiger Ketten oder Sortierung.
- `deployment/base-agent-sha256.json`: eingefrorene SHA-256-Werte der zwölf Basisprofile (Dateinamen relativ zum Agentverzeichnis); bei absichtlichen Basisänderungen gezielt aktualisieren.

## Wartung ohne callable Fallbackprofile

1. Nur die kanonische JSON bearbeiten; komplette Schrittobjekte einschließlich `request.body` erhalten. Die entfernten `-fallback1.md` bis `-fallback3.md` werden weder zur Laufzeit noch für Wartung/Tests benötigt und dürfen nicht zur Regeneration herangezogen werden.
2. `bun run check:v2` validiert JSON und vergleicht ausschließlich `chain[0].model` mit den zwölf Basisprofilen. `bun run derive:v2` ist ein read-only Kompatibilitätsalias. Abweichungen schlagen fehl, statt JSON zu überschreiben.
3. Nach bewusst geänderter Primärmodellidentität projiziert `bun run sync:v2:bases` ausschließlich die `model:`-Zeile auf die Basisprofile; Prompts, Berechtigungen und sonstige Bytes bleiben erhalten. Alle Profile werden vor dem ersten Schreibzugriff geprüft. Alternative Pfade: `bun scripts/derive-v2-config.ts --check <config.json> <agents-dir>` (bzw. `--sync-base`).
4. `bun test`, `bun run typecheck`, `bun run build`, `bun run test:v2:integration` ausführen. Wartungstests verwenden temporäre zwölf Basisprofile, keine Benutzerprofile oder Fallbackdateien.
5. Minimale geänderte Artefakte zur aktiven Installation synchronisieren und bytegleich prüfen. Kein automatischer Live-Reload: der Benutzer lädt selbst neu.

Die 36 ehemaligen callable Profile sind außerhalb der OpenCode-Discovery unter `~/.local/state/opencode-plugin-backups/` gesichert; der konkrete Pfad und geprüfte Hashes stehen in `evidence/json-ssot-migration.json`.

## Begrenztes zyklisches Fallback (maxCycles)

`maxCycles` (Integer 1–5, fehlt ⇒ sicherer Default `1` = bisheriges Verhalten ohne Wrap) begrenzt die **Kettenumdrehungen pro Child-Session**: Der erste Vorwärtsdurchlauf ist Pass 1; ein Wechsel vom letzten Kettenmodell zurück zu einem früheren ist Pass 2 usw. Mit `maxCycles: 5` werden also höchstens fünf Durchläufe genutzt — der sechste wird blockiert, selbst wenn zwischenzeitlich Cooldowns abgelaufen sind. Ein Budget wird beim Umdrehen verbraucht, nicht pro Retry: Wechsel a→b innerhalb desselben Durchlaufs zählt nicht zusätzlich. Der Vorwärtsdurchlauf endet am letzten Modell; zurück geht es nur per Umdrehung zum frühesten abgekühlten verfügbaren Modell (Standard-Wrap kehrt zum ersten Modell der Kette zurück, wenn verfügbar).

Verbrauch/Stop:

- Zustand ist pro `sessionID` (Index, Pass, stopped) über die Plugin-Lebensdauer; Retries und Prompt-Hooks replenishieren das Budget nie.
- Ein neues Child startet immer bei Pass 1, auch mitten in einer Kette (Preemptiv-Umleitung verbraucht keinen Pass).
- Wenn kein Kandidat bereit ist (alle im Cooldown, Katalog/variante fehlt), stoppt das Kind sofort `retry:false` — kein Warten auf Cooldown-Ablauf, kein Durchlauf-„Verschwenden".
- Nach endgültigem Stop bleiben spätere Retries/Prompts dieses Childs gestoppt, bis zur Abgabe des Plugin-Handlers (Dispose).

Stale-Schutz: Native `attempt`-Nummern starten pro logischem Schritt neu. Ein Retry-Event wird verworfen, wenn `attempt` nicht strikt über dem zuletzt behandelten steht; ein erfolgreicher primärer `http.response` (200) des Childs hebt nur diesen Zaun — nie das Pass-Budget. Ein veralteter Retry für ein früheres Modell kann das Child nie rückwärts bewegen, auch nicht nach Wrap.

Die Deploymentdateien enthalten lokale Pfade und sind kein portables Standardsetup. Bei Änderungen zuerst Skripte und Konfiguration lesen; nur explizites `--sync-base` schreibt Basis-Modellzeilen, niemals Ketten. Diese Kopie wurde nicht erneut gegen reale Provider authentifiziert.

## Verifizierter Ausgangsstand

OpenCode 2.0.25; 179 Tests bestanden, Typecheck und Build erfolgreich. Privater Integrationstest bestätigte drei abgeschlossene Child-Jobs, Parent-Fortsetzung, Varianten und isolierte Overrides. Die aktive Installation wurde separat geladen und als `smart-coders.model-fallback.v2-local` bestätigt.

## Grenzen und spätere Arbeit

- Nur konfigurierte Child-Subagents, keine Primary-/Wildcard-Ketten.
- HTTP-JSON-Overrides unterstützt; WebSocket-Frame-Overrides nicht implementiert.
- Bestehende Legacy-Status-/Toast-Funktionen gehören nicht zum v2-Einstieg.
- Vor einem OpenCode-Upgrade erneut Typecheck und privaten Integrationstest ausführen.
- Die portable Paketinstallation und Beispielkonfiguration stehen in [README.md](../README.md); Releasebootstrap, Freigaben und Recovery stehen in [docs/releases.md](releases.md). Das Paket ist vorbereitet, aber noch nicht auf npm veröffentlicht.

Die bestehende lokale Deploymentinstallation wurde durch diese Paket-/Releaseänderung nicht automatisch aktiviert oder neu geladen. Ihre Aktivierung/Rücknahme ist in `deployment/ACTIVATION.md` dokumentiert.
