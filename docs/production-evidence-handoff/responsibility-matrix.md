# Responsibility matrix

| Domain | Responsible role | Independent controller | Accountable outcome |
|---|---|---|---|
| Environment identity | system-owner | security-owner | Exact target and separation |
| Deployment topology | operations-owner | system-owner | Complete process/writer inventory |
| Database access | database-owner | security-owner | Effective least privilege |
| Maintenance fence | operations-owner | independent-reviewer | Active tested global exclusion |
| Backup and restore | recovery-owner | independent-reviewer | Restorable target-bound backup |
| Monitoring and abort | operations-owner / incident-owner | database-owner | Observable bounded operation |
| Approval records | approving owner for class | independent-reviewer | Scoped, expiring authorization |
| Status preservation | independent-reviewer | system-owner | No false collection or readiness |

Roles are placeholders for accountable functions, not people. Identity,
authority and availability of actual operators must be established outside the
repository for the exact approved window.
