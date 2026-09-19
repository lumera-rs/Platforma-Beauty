# Blocked and missing evidence

Global readiness is `BLOCKED` because repository review cannot establish the
following mandatory production facts.

| Evidence package | Responsible role | Required contents | Consequence if absent |
|---|---|---|---|
| Target identity | System owner | target/environment/schema/revision/window/digest | No production configuration or DB access |
| Deployment topology | Operations owner | active revisions, instances, writers, workers, schedulers, startup reachability | No diagnostic access |
| Maintenance fencing | System + operations owners | proven drain/write fence honored by every process | No limited data scan |
| Diagnostic DB role | DB/data + security owners | grants, no escalation/write path, GUCs, audit attribution | No DB connection |
| Monitoring plan | Operations/incident owner | live monitors, numeric thresholds, abort operator and cancel path | No diagnostic |
| Backup/PITR | Recovery owner | exact-target configuration, retention and latest successful backup | Readiness remains blocked |
| Restore rehearsal | Recovery owner + independent reviewer | isolated restore, integrity outcome, RPO/RTO measurements | Readiness remains blocked |
| Business/data policy | Business/policy and data/privacy owners | permitted facts, minimization, retention, compensation boundaries | No evidence collection |
| Independent scope review | Independent reviewer | initial scope approval and final disposition | No execution or status decision |

## Evidence that is not sufficient

- repository configuration or development database state;
- presence of credentials or integrations;
- enabled backup without tested restore;
- source-level advisory locks without live topology proof;
- row limits without cost/byte evidence;
- historical or stale screenshots/attestations;
- database metadata for organizational approvals;
- successful static validation of this package.

No missing evidence is collected by this preparation.