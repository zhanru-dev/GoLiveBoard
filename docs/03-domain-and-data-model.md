# 03 · Domain and data model

## 1. Bounded areas

| Area                 | Owns                                                                           | Key rules                                                                                |
| -------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Identity and tenancy | users, workspaces, memberships, sessions, team invitations                     | Everything staff can see belongs to one workspace; roles are read fresh on every request |
| Event preparation    | events, runbook tasks, access policies, assets, stream checks, incidents       | The lifecycle state machine; hard blockers gate `READY` and `LIVE`                       |
| Audience             | attendees, invitations, verification, attendee sessions, reminders, attendance | Eligibility re-checked on every request; personal data has a retention limit             |
| Live interaction     | chat messages, questions, votes, real-time journals, triage runs               | No lost or duplicated messages; moderation is audited; AI only suggests                  |
| Record               | audit entries, outbox, webhooks, reports, idempotency records                  | Side effects happen exactly when the change commits                                      |

## 2. Event lifecycle

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> CONFIGURING
  CONFIGURING --> READY: no hard blockers
  READY --> CONFIGURING
  READY --> LIVE: no hard blockers
  LIVE --> COMPLETED
  COMPLETED --> ARCHIVED
  DRAFT --> CANCELLED
  CONFIGURING --> CANCELLED
  READY --> CANCELLED
  CANCELLED --> ARCHIVED
  ARCHIVED --> [*]
```

The transition table lives in `apps/api/src/events/domain/lifecycle.ts` as data, not as scattered `if` statements. A transition is applied inside one transaction:

1. lock the event row (`SELECT … FOR NO KEY UPDATE`, which unlike `FOR UPDATE` lets foreign-key checks from rows that merely point at the event proceed);
2. check the transition is allowed from the **current** status;
3. for `READY` and `LIVE`, evaluate readiness from the current data and reject if any hard blocker remains;
4. update the status and version, write the audit entry (including the readiness result) and the outbox message.

Because step 1 serialises concurrent requests for the same event, two simultaneous "go live" requests produce one success and one `409`.

Every write to something that belongs to an event (runbook tasks, access policy, stream, assets) takes the same row lock first, and so does the worker before it records a stream check (a check is evidence for readiness: it waits for a transition that has already judged readiness, and lands after it; under the lock it re-reads the status and drops the result if the event was archived meanwhile) (`lockWritableEvent` in `apps/api/src/events/event-lock.queries.ts`). That gives three guarantees with one rule: a transition's readiness check sees no half-finished change and none can commit before it; an archived event cannot receive a write that started just before it was archived; and runbook positions stay `1, 2, 3…` under concurrent adds and moves.

## 3. Readiness rules

Readiness is a **pure function** of the event's current data: `assessReadiness(input, ruleVersion) → { score, criteria[], blockers[], nextActions[] }`. It has no database or clock access; the caller passes everything in, including "now".

| Criterion                                                  | Max points | Hard blocker when        |
| ---------------------------------------------------------- | ---------- | ------------------------ |
| Access policy configured                                   | 20         | missing                  |
| Stream reachable (latest check succeeded within 5 minutes) | 25         | failing or never checked |
| Critical runbook tasks done                                | 25         | any critical task open   |
| Holding slate uploaded                                     | 10         | missing                  |
| All runbook tasks done                                     | 10         | —                        |
| Owner assigned and description written                     | 10         | —                        |

Scoring details in rule version 1: "All runbook tasks done" gives points in proportion to completed tasks, rounded down, and 0 for an empty runbook (an event with no plan is not ready); "Owner assigned and description written" gives 5 points for each; the other criteria are all or nothing, and a runbook without critical tasks passes "Critical runbook tasks done". Next actions list those that remove a hard blocker first, then by points gained, then in table order. A transition to `READY` or `LIVE` stores the rule version and score in its audit entry.

Stream checks count only for the URL they checked: changing the stream URL makes the stream "not checked yet" until the new URL is checked. Setting the URL queues a check at once, and Managers can ask for one at any time, because scheduled checks start only an hour before the event while readiness needs a check under 5 minutes old.

Rule changes create a new rule version; tests pin each version's behaviour.

## 4. Entity relationship diagrams

### 4.1 Identity and tenancy

```mermaid
erDiagram
  User ||--o{ Membership : has
  Workspace ||--o{ Membership : has
  User ||--o{ Session : signs_in_with
  Workspace ||--o{ TeamInvitation : sends
  User ||--o{ PasswordResetToken : requests

  User {
    uuid id PK
    citext email UK
    text name
    text passwordHash
    timestamptz disabledAt
  }
  Workspace {
    uuid id PK
    text name
    int retentionDays
    boolean isDemo
  }
  Membership {
    uuid id PK
    uuid workspaceId FK
    uuid userId FK
    enum role "OWNER | MANAGER | ANALYST"
  }
  Session {
    uuid id PK
    uuid userId FK
    uuid activeWorkspaceId FK
    text refreshTokenHash UK
    text previousRefreshTokenHash
    timestamptz rotatedAt
    timestamptz refreshExpiresAt
    timestamptz revokedAt
  }
  TeamInvitation {
    uuid id PK
    uuid workspaceId FK
    citext email
    enum role
    text tokenHash UK
    timestamptz expiresAt
    timestamptz acceptedAt
    timestamptz revokedAt
  }
  PasswordResetToken {
    uuid id PK
    uuid userId FK
    text tokenHash UK
    timestamptz expiresAt
    timestamptz usedAt
  }
```

### 4.2 Event preparation

```mermaid
erDiagram
  Workspace ||--o{ Event : owns
  Event ||--o{ RunbookTask : has
  Event ||--o| AccessPolicy : has
  Event ||--o{ Asset : has
  Event ||--o{ StreamCheck : has
  Event ||--o{ Incident : has

  Event {
    uuid id PK
    uuid workspaceId FK
    text slug UK
    text title
    text description
    timestamptz startsAt
    timestamptz endsAt
    text timeZone
    uuid ownerUserId FK
    int expectedAttendance
    enum status
    text streamUrl
    int version
    bigint chatSequence
    bigint questionsSequence
    timestamptz createdAt
    timestamptz updatedAt
  }
  RunbookTask {
    uuid id PK
    uuid eventId FK
    text title
    boolean isCritical
    enum status "TODO | DONE"
    int position
    uuid ownerUserId FK
    timestamptz dueAt
    timestamptz completedAt
    uuid completedById FK
    int version
  }
  AccessPolicy {
    uuid eventId PK
    enum mode "PUBLIC | EMAIL_DOMAIN | INVITE_ONLY"
    text_array allowedDomains
    text privacyNoticeVersion
    int version
  }
  Asset {
    uuid id PK
    uuid eventId FK
    enum kind "HOLDING_SLATE"
    text storageKey UK
    enum status "PENDING | READY | REJECTED"
    text contentType
    int sizeBytes
  }
  StreamCheck {
    uuid id PK
    uuid eventId FK
    text url
    timestamptz slot
    timestamptz checkedAt
    boolean ok
    int httpStatus
    int latencyMs
    text failure
  }
  Incident {
    uuid id PK
    uuid eventId FK
    enum kind "STREAM_UNREACHABLE"
    timestamptz openedAt
    timestamptz resolvedAt
  }
```

### 4.3 Audience and live interaction

```mermaid
erDiagram
  Event ||--o{ Attendee : registers
  Event ||--o{ AttendeeInvitation : invites
  Attendee ||--o{ VerificationToken : verifies_with
  Attendee ||--o{ AttendeeSession : watches_with
  Attendee ||--o{ ReminderDelivery : receives
  Attendee ||--o{ AttendanceMinute : attends
  Event ||--o{ ChatMessage : has
  Event ||--o{ Question : has
  Question ||--o{ QuestionVote : receives
  Event ||--o{ RealtimeJournal : records
  Event ||--o{ TriageRun : has

  Attendee {
    uuid id PK
    uuid eventId FK
    citext email
    text name
    enum status "PENDING | VERIFIED | REVOKED | ERASED"
    text consentNoticeVersion
    boolean remindersOptIn
  }
  AttendanceMinute {
    uuid eventId PK
    uuid attendeeId PK
    timestamptz minute PK
  }
  ChatMessage {
    uuid id PK
    uuid eventId FK
    bigint sequence
    text authorKey
    text clientMessageId
    text body
    timestamptz deletedAt
  }
  Question {
    uuid id PK
    uuid eventId FK
    text body
    enum status "PENDING | PUBLISHED | HIDDEN | ANSWERED"
    smallint pinSlot
    uuid mergedIntoId FK
    int voteCount
    int version
  }
  RealtimeJournal {
    uuid eventId PK
    enum channel PK "CHAT | QUESTIONS"
    bigint sequence PK
    text kind
    uuid entityId
  }
  TriageRun {
    uuid id PK
    uuid eventId FK
    enum outcome "SUCCEEDED | FAILED | TIMED_OUT"
    text model
    int latencyMs
    int inputTokens
    int outputTokens
    jsonb suggestions
    enum decision "PENDING | ACCEPTED | PARTIAL | REJECTED"
  }
```

### 4.4 Record

```mermaid
erDiagram
  Workspace ||--o{ AuditEntry : records
  Workspace ||--o{ OutboxMessage : emits
  Workspace ||--o{ WebhookEndpoint : configures
  WebhookEndpoint ||--o{ WebhookDelivery : receives
  OutboxMessage ||--o{ WebhookDelivery : fans_out_to
  WebhookDelivery ||--o{ WebhookAttempt : has
  Event ||--o| EventReport : summarised_by

  AuditEntry {
    uuid id PK
    uuid workspaceId FK
    uuid eventId FK
    enum actorKind "USER | ATTENDEE | SYSTEM"
    uuid actorUserId FK
    text action
    text targetType
    uuid targetId
    jsonb before
    jsonb after
    text requestId
  }
  OutboxMessage {
    uuid id PK
    uuid workspaceId FK
    text type
    jsonb payload
    jsonb traceContext
    timestamptz dispatchedAt
  }
  WebhookEndpoint {
    uuid id PK
    uuid workspaceId FK
    text url
    text_array eventTypes
    bytea secretCiphertext
    boolean active
  }
  WebhookDelivery {
    uuid id PK
    uuid endpointId FK
    uuid outboxMessageId FK
    enum status "PENDING | SUCCEEDED | FAILED"
    int attempts
    timestamptz nextAttemptAt
  }
  WebhookAttempt {
    uuid id PK
    uuid deliveryId FK
    int statusCode
    int durationMs
    text error
  }
  EventReport {
    uuid eventId PK
    timestamptz generatedAt
    jsonb data
  }
```

`IdempotencyRecord (scope, key, requestHash, responseStatus, responseBody, expiresAt)` stores responses to retried requests for 24 hours. The primary key is `(scope, key)`; the scope names the workspace, the user and the operation (`<workspaceId>:<userId>:create-event`), so a key never replays another user's response. Requests with the same key are serialised by a transaction-scoped advisory lock on the scope and key, and the record is written in the same transaction as the create.

`PendingFilePurge (prefix, notBefore)` records storage prefixes whose files must be deleted once nothing can write to them any more: the demo reset records the prefixes of the events it deletes, with `notBefore` after the last upload link handed out for them has expired. The worker's maintenance sweep, every 5 minutes, empties each due prefix and only then deletes its row, so a storage outage of any length loses nothing. An earlier build recorded these as `demo.events_deleted` outbox messages with a purge job; a migration copies what those messages describe into the table, and the worker still accepts both the message and the job, recording their prefixes the same way, so an upgrade loses none.

## 5. Invariants and where they are enforced

The rule of thumb: **if a rule must hold under concurrency, the database enforces it**; the application also checks it first so users get a clear error.

| Invariant                                                    | Enforcement                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A user is a member of a workspace at most once               | Unique `(workspaceId, userId)`                                                                                                                                                                                                                                                                                                                                                            |
| A workspace always has at least one Owner                    | Checked in the transaction that changes roles, with the workspace's memberships locked                                                                                                                                                                                                                                                                                                    |
| Only the newest invitation link for an address works         | Partial unique index `(workspaceId, email) WHERE acceptedAt IS NULL AND revokedAt IS NULL`; creates for one address are serialised by an advisory lock and revoke the previous one                                                                                                                                                                                                        |
| No session survives a password reset                         | Sign-in re-reads the password hash `FOR SHARE` in the transaction that creates the session; the reset updates the user row, then revokes sessions, in one transaction                                                                                                                                                                                                                     |
| An event ends after it starts                                | Check constraint `ends_at > starts_at`; the API checks the merged values first to name the field                                                                                                                                                                                                                                                                                          |
| A retried create never creates twice                         | Primary key `(scope, key)` on `IdempotencyRecord`, written in the create's transaction under an advisory lock on the key                                                                                                                                                                                                                                                                  |
| An event cannot reach `READY` or `LIVE` with a hard blocker  | Event row locked, readiness re-evaluated inside the transaction                                                                                                                                                                                                                                                                                                                           |
| Edits based on stale data are rejected                       | `version` compared in the `UPDATE … WHERE id = $1 AND version = $2`; zero rows updated → `412`                                                                                                                                                                                                                                                                                            |
| Runbook positions are `1, 2, 3…` per event                   | Every runbook write locks the event row; positions are renumbered in one statement after a move or delete; check constraint `position > 0`                                                                                                                                                                                                                                                |
| An `EMAIL_DOMAIN` policy lists domains, other modes none     | Check constraint on `access_policies`, and the request schema                                                                                                                                                                                                                                                                                                                             |
| An asset is `READY` only after its bytes are verified        | The browser uploads to `uploads/<key>`; the upload URL signs the declared type and length. `complete` locks the asset row, then the event row, copies the upload to `<key>` (which no presigned URL can write) and checks that copy's size and magic bytes; a mismatch marks it `REJECTED` and only then deletes the files. Reusing the upload URL later cannot change the verified slate |
| A stream-check job that runs twice records one check         | Unique `(eventId, slot)` on `StreamCheck`; inserted with `ON CONFLICT DO NOTHING`, and the incident is judged only when a row was inserted                                                                                                                                                                                                                                                |
| At most one open incident of a kind per event                | Partial unique index `(eventId, kind) WHERE resolvedAt IS NULL`                                                                                                                                                                                                                                                                                                                           |
| At most 3 pinned questions per event                         | `pinSlot` in 1–3 (check constraint) + partial unique index `(eventId, pinSlot) WHERE pinSlot IS NOT NULL`                                                                                                                                                                                                                                                                                 |
| One vote per attendee per question                           | Primary key `(questionId, attendeeId)`                                                                                                                                                                                                                                                                                                                                                    |
| A retried chat send never duplicates                         | Unique `(eventId, authorKey, clientMessageId)`                                                                                                                                                                                                                                                                                                                                            |
| Real-time sequences have no gaps or duplicates               | Sequence allocated by `UPDATE event SET chatSequence = chatSequence + 1 … RETURNING` in the same transaction as the journal insert; primary key `(eventId, channel, sequence)`                                                                                                                                                                                                            |
| An attendee registers once per event                         | Unique `(eventId, email)` on `Attendee` (citext); a registration inserts with `ON CONFLICT DO NOTHING` and otherwise updates the row it locked                                                                                                                                                                                                                                            |
| A revoked or erased attendee loses access at once            | Every attendee request reloads session, attendee, event and policy and decides again; revoking and erasing also delete their sessions and unused links. Writes lock the attendee before its links (verification too), so using a link while it is revoked cannot deadlock                                                                                                                 |
| An attendee's status and its timestamps agree                | Check constraints on `attendees` (`VERIFIED` has `verifiedAt`, `REVOKED` has `revokedAt`, `ERASED` exactly when `erasedAt`)                                                                                                                                                                                                                                                               |
| Each reminder is sent at most once                           | Unique `(attendeeId, kind)` on `ReminderDelivery`, inserted before sending                                                                                                                                                                                                                                                                                                                |
| A webhook is delivered at most once per endpoint per message | Unique `(endpointId, outboxMessageId)`                                                                                                                                                                                                                                                                                                                                                    |
| Tokens are single-use                                        | Conditional `UPDATE … SET usedAt = now() WHERE tokenHash = $1 AND usedAt IS NULL AND expiresAt > now()`                                                                                                                                                                                                                                                                                   |
| Staff data never crosses workspaces                          | Every query filters by `workspaceId`; cross-tenant tests per endpoint                                                                                                                                                                                                                                                                                                                     |

## 6. Identifiers, time and money

- **IDs** are UUID v7 (time-ordered, good index locality), generated by the database with PostgreSQL 18's built-in `uuidv7()`.
- **Public URLs** use the event `slug` (readable title plus random suffix); internal IDs never appear in public pages.
- **Time** is stored as `timestamptz` in UTC. Each event stores an IANA time zone for display. The server never uses the host's local time zone.
- **Email addresses** use the `citext` type, so uniqueness ignores case.
- **AI cost** is stored as an integer number of micro-dollars, never as a floating-point value.

## 7. Indexes

Every foreign key is indexed. Additional indexes follow the main queries:

| Query                                  | Index                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------- |
| Event list per workspace by start time | `(workspaceId, startsAt DESC, id DESC)`                                   |
| Event search by title                  | trigram index on `title` (`pg_trgm`)                                      |
| Real-time catch-up                     | primary key `(eventId, channel, sequence)`                                |
| Published questions by votes           | `(eventId, status, voteCount DESC)`                                       |
| Audit search                           | `(workspaceId, createdAt DESC)`, `(workspaceId, eventId, createdAt DESC)` |
| Outbox relay                           | partial index `(createdAt) WHERE dispatchedAt IS NULL`                    |
| Webhook retries                        | partial index `(nextAttemptAt) WHERE status = 'PENDING'`                  |

## 8. Data retention

| Data                          | Kept for                                                          | Then                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Attendee name and email       | Workspace retention period after the event ends (default 90 days) | Anonymised: name becomes "Former attendee", email replaced by a non-reversible hash, sessions and tokens deleted |
| Attendee erased on request    | —                                                                 | Anonymised immediately, the same way                                                                             |
| Verification and reset tokens | Until used or expired                                             | Deleted by the daily retention job                                                                               |
| Stream checks                 | 30 days                                                           | Deleted                                                                                                          |
| Attendance minutes            | Until the report is generated, plus 30 days                       | Deleted; the report keeps aggregates only                                                                        |
| Chat messages and questions   | Lifetime of the event                                             | Deleted with the event; authorship anonymised with the attendee                                                  |
| Audit entries                 | 2 years                                                           | Deleted                                                                                                          |
| Idempotency records           | 24 hours                                                          | Deleted                                                                                                          |
| Webhook delivery attempts     | 30 days                                                           | Deleted                                                                                                          |

The daily retention job is idempotent and audited as `SYSTEM`.
