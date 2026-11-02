# Release- und Recovery-Runbook

## Quellen und aktueller Stand

Die maßgebliche Releasekonfiguration liegt in `.releaserc.json`, `.github/workflows/release.yml`, `.github/workflows/ci.yml` und `scripts/prepare-release.ts`. Für npm-OIDC-Voraussetzungen gilt die [offizielle Trusted-Publishing-Dokumentation](https://docs.npmjs.com/trusted-publishers). Paketprüfung und ihre Scratch-Isolation sind in `scripts/check-package.ts` implementiert; der Vertrag ist in `test/release-config.test.ts` verankert. Bei Abweichungen ist der aktuelle Stand dieser Dateien maßgeblich.

Das Paket heißt `@melivo/opencode-model-fallback`. Die Quellbaseline bleibt `0.1.0`; semantic-release setzt die Version nur im temporären Releasecheckout. Verfügbare npm-Versionen und GitHub-Releases sind die Quellen für veröffentlichte Artefakte und Releaseinformationen. Vor einer Erstveröffentlichung müssen Registry- und CI-Belege den Veröffentlichungsweg bestätigen. `RELEASE_ENABLED` ist eine GitHub-Repositoryvariable, kein Secret, und muss für einen Release ausdrücklich `true` sein.

## Versionen und Notes

Das bestehende Angular-Preset wertet Commitnachrichten aus: `fix:` und `perf:` ergeben Patch, `feat:` und eine erkannte inkompatible Änderung Minor. Bei 0.x ist damit inkompatible Änderung ein Minor-Sprung; ein Wechsel zu 1.0 benötigt eine separate Policyentscheidung. Gemischte Commits nehmen den höchsten Sprung. `docs:` und `chore:` allein ergeben keinen Release. Für inkompatible Änderungen die vom Angular-Preset erkannte Footerform `BREAKING CHANGE: …` verwenden. `feat!:` ohne diesen Footer wird vom aktuell getesteten Parser nicht als Breaking Change erkannt.

Neue Notes entstehen in GitHub Release Notes. Historisches Upstream-`CHANGELOG.md` bleibt erhalten; es wird kein Git-Changelog generiert oder geschrieben. Es gibt keine Botcommits. Eigene Release-Tags beginnen mit `melivo-v`; die Upstream-Tags `v1.0.0` bis `v1.3.4` bleiben unangetastet.

## Lokale Prüfung und getrennte Freigaben

Vor jeder Fernwirkung muss ein exakter Commit samt enthaltenen Änderungen separat freigegeben sein. Fremde uncommittete Änderungen werden weder still übernommen noch verworfen. Pflichtchecks sind auf einem sauberen Checkout dieses freigegebenen Commits erneut auszuführen. Lokale Paketprüfung ist keine Veröffentlichungsfreigabe.

Die Workflow-Pins und Paket-/CLI-Versionen stehen ausschließlich in den Workflow- und Paketdateien; vor einer Änderung dort die aktuellen Werte lesen, nicht aus diesem Runbook ableiten. CI führt Paketprüfung in eigenem Scratch aus. Lokal nutzt `bun run test:package` denselben Check; `bun run test:package --tarball <tgz>` prüft exakt ein vorhandenes Archiv ohne Neupacken. `--registry-version <version>` prüft eine öffentliche Registryversion. Der Check installiert das npm-Archiv und die exakt gepinnte OpenCode-CLI isoliert, führt private lokale Fixtures aus und schreibt Evidence nur in sein eigenes Scratchverzeichnis. Er nutzt keine echten Provider oder Benutzercredentials. Ein Dry-run oder npm whoami beweist weder OIDC noch eine erfolgreiche öffentliche Paketinstallation.

## Erstveröffentlichung und OIDC

Der Agent übernimmt die freigegebene Veröffentlichung. Für CLI-Login öffnet der Agent die npm-CLI-Browserloginseite in Chrome und wartet; der Nutzer übernimmt dort ausschließlich Login/2FA. Ein Login auf der npm-Website allein authentifiziert die lokale CLI nicht. Authentifizierungsdaten gehören weder in Repository, Logs noch GitHub-Secrets. Für Bootstrap wird eine kurzlebige lokale npm-CLI-Sitzung bzw. temporäre lokale npm-Konfiguration verwendet; keine dauerhafte persönliche Konfiguration ändern und keine Tokens im Projekt speichern.

Vor der Erstveröffentlichung müssen echte Registry- und CI-Belege den freigegebenen Veröffentlichungsweg bestätigen. Erst dann das getestete Tarball interaktiv veröffentlichen und den freigegebenen Tag sowie GitHub-Release am exakt freigegebenen Commit mit demselben geprüften Archiv erstellen. Keine Upstream-Tags übernehmen oder ändern. Es erfolgt keine automatische Pluginaktivierung.

Der Workflow veröffentlicht nur für das origin-Repository `Melivo/opencode-model-fallback` auf `main` oder manuellem Dispatch auf diesem Branch, wenn `vars.RELEASE_ENABLED == 'true'`. Pull-Request-/CI-Jobs haben keine Publishingrechte. Nur der Releasejob hat `contents: write` und `id-token: write`. OIDC Trusted Publishing ersetzt `NPM_TOKEN`/`NODE_AUTH_TOKEN`; `GITHUB_TOKEN` für GitHub-Releases bleibt erlaubt. Die npm Trusted-Publisher-Registrierung gehört nicht zur lokalen Bootstrapvorbereitung: Sie wird erst kurz vor einem tatsächlich geplanten Folge-Release eingerichtet, dann muss die erste OIDC-Veröffentlichung innerhalb von zwei Tagen erfolgen. Exakt eintragen: GitHub-Owner `Melivo`, Repository `opencode-model-fallback`, Workflowdatei `release.yml` ohne Pfadpräfix, GitHub-hosted Runner. In npm ist direkte Publikation ausdrücklich zu erlauben. npm-Veröffentlichungen aus öffentlicher CI erzeugen Provenance; lokale Bootstrappublikation beweist diese CI-Provenance nicht. Erst nach erfolgreicher OIDC-Veröffentlichung kann der Nutzer die tokensperrende 2FA-Publishingeinstellung bestätigen.

## Ablauf und Recovery

Die Releasekonfiguration versioniert/buildet im temporären Checkout, erzeugt einen Tarball, prüft genau dieses Archiv, latcht dessen SHA-512 und veröffentlicht anschließend denselben Tarball über die freigegebene npm-CLI. Git-Tags werden vor npm-Publikation gepusht. GitHub-Release und Asset verwenden denselben Tarball und Release Notes. Das CI-Artefakt enthält für sieben Tage Tarball, SHA-512-Latch und Registry-Check-Evidence.

Nach möglichem Teilerfolg zuerst vorhandenen Tag, npm-Version, Registry-Integrity, GitHub-Asset/Notes und Commitbezug inventarisieren. Bei Fehlern oder Zeitüberschreitung niemals blind Workflow erneut starten, doppelt publizieren, eine bestehende Version unpublishen, Tags löschen oder force-pushen. Registry-Readback hat begrenzte Wiederholungen und vergleicht SHA-512-Integrity und SHA-1-SHA-Summe mit dem geprüften Archiv. Bei Abweichung oder erschöpftem Readback anhalten und Zustand prüfen. Für gezielte Recovery darf das erhaltene CI-Archiv nur nach gesonderter Freigabe verwendet werden.

Die Repositoryvariable `RELEASE_ENABLED` auf `false` zu setzen stoppt weitere Publikationen; bereits veröffentlichte npm-Versionen und bestehende Installationen werden dadurch nicht entfernt.

## Offene Live-Nachweise

Bis zu einem tatsächlich autorisierten Lauf sind OIDC-Veröffentlichung über GitHub Actions, öffentliche Registry-Downloadprüfung samt privaten Fixtures, Provenance sowie GitHub-Tag/Commit/Asset/Notes-Verknüpfung offen. Erst diese Belege schließen das Releaseziel vollständig ab.
