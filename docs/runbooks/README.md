# Runbooks

What to do when something goes wrong, or for routine work that must not go wrong (docs/06, section 9). Each one has the same shape:

1. **Symptoms:** how you notice. Usually an alert email from Grafana, which names its runbook.
2. **Checks:** what to look at, in order, to find which case you are in.
3. **Actions:** what to do in each case.
4. **Verification:** how you know it worked.

Each runbook has two sections: **locally**, on the production-like stack (`npm run stack:up`), where it was rehearsed in milestone 9; and **in AWS**, written ahead of milestone 10 and rehearsed there. Every rehearsal is logged at the end of its runbook.

| Runbook                                                        | When                                                                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Deploy and roll back](deploy-and-roll-back.md)                | Every release; a failed smoke test; "API 5xx rate above 2%"; "API readiness check failing"; "Worker not reporting"; "Work waiting more than 5 minutes" |
| [Restore the database to a point in time](restore-database.md) | Data lost or corrupted                                                                                                                                 |
| [Rotate a secret](rotate-a-secret.md)                          | A suspected leak; scheduled rotation                                                                                                                   |
| [Webhook endpoint failing](webhook-endpoint-failing.md)        | "Webhook endpoint failing"                                                                                                                             |
| [Stream check reports false outages](stream-false-outages.md)  | Incidents opened while the stream plays                                                                                                                |
| [Demo reset failed](demo-reset-failed.md)                      | The demo workspace not reset by 06:00; a `demo-reset` error in Sentry                                                                                  |

**Where to look:**

- Grafana is at http://127.0.0.1:3037 on the stack (Grafana Cloud in AWS), with the **GoLiveBoard overview** dashboard.
- Traces are in Tempo: search by `trace_id` from any log line.
- Logs: `docker compose -f docker-compose.prod.yml logs <service>` locally, Loki in AWS.
