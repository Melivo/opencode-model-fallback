# Wartungsnotizen (Draft)

## Relevante Dateien

- `src/v2.ts`: native v2-Hooks, Modellauswahl und schrittbezogene HTTP-Body-Overrides.
- `test/v2-*.test.ts`: v2-Regressionsprüfungen.
- `scripts/integration-v2.py`: privater v2-Testserver; Child-Abschluss und Parent-Fortsetzung.
- `scripts/derive-v2-config.ts`: Ableitung der Ketten aus lokalen Agentdateien.
- `deployment/model-fallback.v2.json`: aktueller persönlicher Stand, zwölf Rollen mit je vier Modellschritten.
- `deployment/agent-source-sha256.json`: Hashes der ursprünglichen 48 Agentdateien.

## Begrenztes zyklisches Fallback (maxCycles)

`maxCycles` (Integer 1–5, fehlt ⇒ sicherer Default `1` = bisheriges Verhalten ohne Wrap) begrenzt die **Kettenumdrehungen pro Child-Session**: Der erste Vorwärtsdurchlauf ist Pass 1; ein Wechsel vom letzten Kettenmodell zurück zu einem früheren ist Pass 2 usw. Mit `maxCycles: 5` werden also höchstens fünf Durchläufe genutzt — der sechste wird blockiert, selbst wenn zwischenzeitlich Cooldowns abgelaufen sind. Ein Budget wird beim Umdrehen verbraucht, nicht pro Retry: Wechsel a→b innerhalb desselben Durchlaufs zählt nicht zusätzlich. Der Vorwärtsdurchlauf endet am letzten Modell; zurück geht es nur per Umdrehung zum frühesten abgekühlten verfügbaren Modell (Standard-Wrap kehrt zum ersten Modell der Kette zurück, wenn verfügbar).

Verbrauch/Stop:
- Zustand ist pro `sessionID` (Index, Pass, stopped) über die Plugin-Lebensdauer; Retries und Prompt-Hooks replenishieren das Budget nie.
- Ein neues Child startet immer bei Pass 1, auch mitten in einer Kette (Preemptiv-Umleitung verbraucht keinen Pass).
- Wenn kein Kandidat bereit ist (alle im Cooldown, Katalog/variante fehlt), stoppt das Kind sofort `retry:false` — kein Warten auf Cooldown-Ablauf, kein Durchlauf-„Verschwenden".
- Nach endgültigem Stop bleiben spätere Retries/Prompts dieses Childs gestoppt, bis zur Abgabe des Plugin-Handlers (Dispose).

Stale-Schutz: Native `attempt`-Nummern starten pro logischem Schritt neu. Ein Retry-Event wird verworfen, wenn `attempt` nicht strikt über dem zuletzt behandelten steht; ein erfolgreicher primärer `http.response` (200) des Childs hebt nur diesen Zaun — nie das Pass-Budget. Ein veralteter Retry für ein früheres Modell kann das Child nie rückwärts bewegen, auch nicht nach Wrap.

Die Deploymentdateien enthalten lokale Pfade und sind kein portables Standardsetup. Bei Änderungen zuerst Skripte und Konfiguration lesen; Ableitung kann Dateien überschreiben. Diese Kopie wurde nicht erneut gegen reale Provider authentifiziert.

## Verifizierter Ausgangsstand

OpenCode 2.0.25; 179 Tests bestanden, Typecheck und Build erfolgreich. Privater Integrationstest bestätigte drei abgeschlossene Child-Jobs, Parent-Fortsetzung, Varianten und isolierte Overrides. Die aktive Installation wurde separat geladen und als `smart-coders.model-fallback.v2-local` bestätigt.

## Grenzen und spätere Arbeit

- Nur konfigurierte Child-Subagents, keine Primary-/Wildcard-Ketten.
- HTTP-JSON-Overrides unterstützt; WebSocket-Frame-Overrides nicht implementiert.
- Bestehende Legacy-Status-/Toast-Funktionen gehören nicht zum v2-Einstieg.
- Vor einem OpenCode-Upgrade erneut Typecheck und privaten Integrationstest ausführen.
- Später portable Beispielkonfiguration, Deployment-Synchronisierung und eigene Paketmetadaten klären. Upstream-Metadaten und Release-Skript sind momentan geerbt: **nicht veröffentlichen**.

Keine CI-/Releaseautomation, keine Remotes und kein initialer Commit eingerichtet. Die laufende Installation wurde für diesen Repo-Draft nicht umgestellt. Aktivierung/Rücknahme der bisherigen Installation ist in deren `deployment/ACTIVATION.md` dokumentiert.
