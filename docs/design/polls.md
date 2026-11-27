# Live polls (FR-RN-8)

The first version (OpsPilot) had live polls; GoLiveBoard listed them out of scope. They come back because a poll is the quickest way for a moderator to hear from the whole audience, not only from those who ask questions, and the parts it needs (admission, the event's live connections, the report) already exist.

## What a poll is

- A **question** (1–200 characters) and **2 to 6 options** (1–80 characters each, no two alike).
- **Draft → Open → Closed.** Only a draft can be edited or deleted. A poll opens while the event takes interaction (as chat and Q&A do: configuring, ready, live), and **at most one poll is open per event**, so the watch page has one thing to answer. Closing is final. When the event completes or is cancelled, its open poll closes in the same transaction.
- **One vote per attendee per poll**, final. Staff do not vote. A vote needs the attendee to be admitted now (the same check as a question's vote, under the event's lock).

## Who sees what

|                  | Drafts                     | Open poll | Closed polls | Counts                                |
| ---------------- | -------------------------- | --------- | ------------ | ------------------------------------- |
| Managers, Owners | Create, edit, delete, open | Close     | See          | Always, live                          |
| Analysts         | See                        | See       | See          | Always, live                          |
| Attendees        | Never                      | Answer    | See          | Shown after they vote, or once closed |

Counts are **not secret**: every participant receives them, as a vote count on a question is. The watch page shows them only after the attendee has voted, or the poll has closed, so that they do not sway the vote; that is a choice of display, not access control.

## How it stays live

A poll is **state, not a log**: what matters is the latest counts, not every vote in order. So, unlike chat and Q&A, polls get no journal and no replay. Every change sends the whole poll, with a `version` that only increases, to every connection on the event (the event room that `event.status` already uses), across instances through the Valkey adapter. A client keeps the poll with the highest version it has seen, and reloads the list over HTTP whenever it (re)joins. A lost message is therefore corrected by the next one or by the next join.

Votes are counted in the same transaction as the vote (`vote_count` per option, as `vote_count` per question). Announcements of votes are coalesced per poll to **at most one every 500 ms**, reading the counts at send time, so 500 attendees voting at once cost a few broadcasts, not 500.

## Enforced by the database

- One open poll per event: a partial unique index on `(event_id) WHERE status = 'OPEN'`.
- One vote per attendee per poll: primary key `(poll_id, attendee_id)`.
- A vote's option belongs to its poll: a composite foreign key `(option_id, poll_id)`.
- An open poll has an opening time, a closed one a closing time (CHECK constraints).

## In the record

Opening, closing, creating, editing and deleting a poll are audited; votes are not (they are attendees' answers, counted). The event's report lists its closed polls with their counts, and its CSV has a table for them.
