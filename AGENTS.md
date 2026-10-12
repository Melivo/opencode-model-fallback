<!-- CORE-INIT-PROJECT:START -->
## Projekt: OpenCode Model Fallback

- **Stack und Runner:** Node.js 18+, TypeScript als ESM und Bun. Nutze `bun test`, `bun run typecheck`, `bun run build`, `bun run test:v2:integration`; für Stil `bun run lint` bzw. `bun run format:check`.
- **Modulgrenzen:** `index.ts` ist der Plugin-Einstieg; `src/` enthält Legacy-Pluginlogik nach Domänen (`config`, `detection`, `resolution`, `state`, `replay`, `display`, `logging`, `tools`). Der native v2-Einstieg ist `server.js` → `src/v2.ts`; Tests liegen unter `test/`, Integration unter `scripts/integration-v2.py`.
- **Sicherheits- und Freigabegrenzen:** Dieses Repository ist eine Wartungskopie. Änderungen aktivieren das Plugin unter `~/.config/opencode/local-plugins/model-fallback` nicht automatisch. Der v2-Integrationstest nutzt einen privaten OpenCode-Server mit lokalen Testdaten und keine kostenpflichtigen Provider.
- **Code Intelligence:** Gortex → projektspezifisches Serena (TypeScript) → native Werkzeuge. Gortex ist für dieses Repository getrackt; Serena läuft über `.opencode/opencode.jsonc`.
- **Fachrouting:** Bei unklarem Ziel `core-brainstorm`, bei geplantem Vorhaben `core-plan`, für autorisierte Ausführung `core-execute`, danach `core-review`; Ursachenanalyse über `core-debug`, Dokumentationsdrift über `core-docs` und Git-/CI-Themen über `core-devops`. Fachagenten werden nur durch `core-execute` koordiniert.

## Core-Routing und Übergaben

- **Einstieg:** Empfiehl bei materiell unklarer Richtung `core-brainstorm`, bei klarem Vorhaben ohne Plan `core-plan`, bei ausdrücklich gewünschter Ausführung oder Wiederaufnahme eines bestätigten Plans `core-execute` und bei Sitzungswechsel `core-handoff`. Biete `core-milestone` für mehrere getrennte Etappen/Sitzungen an; einfache Vorhaben brauchen keine Etappenstruktur. Empfehlungen starten keinen Workflow und erteilen keine Freigabe.
- **Autorisierte Arbeit:** Führe innerhalb bestehender Freigabe die erforderlichen Prüfungen und das unabhängige `core-review` in frischem Kontext durch, ohne jeden internen Übergang erneut bestätigen zu lassen. Ende nicht bei „Implementierung fertig“. Neue Ziele, Scopeänderungen, Folgeetappen und gesondert freigabepflichtige Aktionen benötigen eigene ausdrückliche Autorisierung; beachte die Reparatur- und Stopgrenzen des zuständigen Skills.
- **Etappenabschluss:** Prüfe nach Run-pass, ob der Plan einen Milestone pinnt. Falls ja, benenne die zusätzliche Kriterienprüfung durch `core-milestone` und führe sie nur bei bestehender Autorisierung durch. Nur dieser Eigentümer verknüpft Abschlussnachweise im Index. Run-pass ist weder Etappen- noch Gesamtzielabschluss. Nach verifiziertem Milestone-Abschluss führe zwingend `core-handoff` mit den exakten Originalartefakten aus und gib den kopierbaren Startprompt im Chat aus; dies ist Bestandteil des Etappenabschlusses, nicht nur ein Angebot. Danach stoppe: Plane oder starte nicht unmittelbar den nächsten Milestone und wechsle weder Auswahl noch Freigabe. Die nächste Etappe wird erst beim ausdrücklich autorisierten Wiedereinstieg ausgewählt/freigegeben. Eine zusätzliche Handoff-Datei benötigt einen ausdrücklich bestätigten separaten Zielpfad. Ist das gesamte Ziel nachweislich erfüllt, gibt `core-handoff` stattdessen den belegten Gesamtabschluss aus, ohne Folgearbeit zu erfinden. Ohne Etappenbindung entfällt dieser Zusatzschritt.
- **Fachmethoden:** Nutze passende Methoden innerhalb des autorisierten Workflows bei konkretem Bedarf, nicht erst nach einem gesonderten Skillaufruf. Brainstorm und Plan nutzen Research, Architecture und Refactor-Safety-Net bei Bedarf inline; ausschließlich Execute dispatcht Fachagenten und weist begrenztes Debugging zu. Berücksichtige Domain- und Dokumentationsbedarf früh, lade nur benötigte Referenzen und starte keine pauschalen Agentenkaskaden.
- **Wiedereinstieg:** Lies die ausdrücklich referenzierten Originalartefakte und den aktuellen Repositorystand neu; wähle keinen vermeintlich neuesten Plan oder Milestone aus Dateinummern. Bei Sitzungswechsel stelle über den zuständigen Eigentümer zuerst einen sicheren Haltepunkt her und biete `core-handoff` an. Fehlende Pfade/Freigaben werden geklärt, nicht aus Chat oder Memory rekonstruiert. Ein Handoff erteilt keine Start- oder Folgefreigabe.
<!-- CORE-INIT-PROJECT:END -->

<!--
MIT License

Copyright (c) 2026 Agent Zero

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
-->

<!-- DOX:START -->
# DOX framework

- DOX is highly performant AGENTS.md hierarchy installed here
- Agent must follow DOX instructions across any edits

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index
- Each parent explains what its direct children cover and what stays owned by the parent
- The closer a doc is to the work, the more specific and practical it must be

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards
- Work Guidance must reflect the current standards of the project or user instructions; if there are no specific standards or instructions yet, leave it empty
- Verification must reflect an existing check; if no verification framework exists yet, leave it empty and update it when one exists

Default section order:
- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

## Style

- Keep docs concise, current, and operational
- Document stable contracts, not diary entries
- Put broad rules in parent docs and concrete details in child docs
- Prefer direct bullets with explicit names
- Do not duplicate rules across many files unless each scope needs a local version
- Delete stale notes instead of explaining history
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist

## Closeout

1. Re-check changed paths against the DOX chain
2. Update nearest owning docs and any affected parents or children
3. Refresh every affected Child DOX Index
4. Remove stale or contradictory text
5. Run existing verification when relevant
6. Report any docs intentionally left unchanged and why

## User Preferences

When the user requests a durable behavior change, record it here or in the relevant child AGENTS.md

## Child DOX Index

- [src/AGENTS.md](src/AGENTS.md) — Plugin runtime and native v2 implementation.
- [test/AGENTS.md](test/AGENTS.md) — Unit and behavior tests.
- [scripts/AGENTS.md](scripts/AGENTS.md) — Maintenance and integration scripts.
<!-- DOX:END -->
