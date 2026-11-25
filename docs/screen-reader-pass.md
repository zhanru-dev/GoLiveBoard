# Screen-reader pass: the golden flow, by ear

The accessibility audit ([accessibility-audit.md](accessibility-audit.md)) checks the structure screen readers rely on:

- landmarks, headings, names and live regions, with axe;
- a keyboard-only walkthrough;
- reflow and contrast.

What it cannot check is **how the pages sound**. That needs a person, and is due before the public demo (milestone 10). This is the script for that pass, and the place its result is recorded.

## Set-up

|                        | Primary                                                                            | Second (if available)                       |
| ---------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------- |
| Screen reader          | VoiceOver (macOS)                                                                  | NVDA (Windows)                              |
| Browser                | Safari                                                                             | Firefox                                     |
| Start                  | <kbd>Cmd</kbd>+<kbd>F5</kbd>                                                       | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> |
| Next or previous item  | <kbd>VO</kbd>+<kbd>→</kbd> / <kbd>←</kbd> (VO = <kbd>Ctrl</kbd>+<kbd>Option</kbd>) | <kbd>↓</kbd> / <kbd>↑</kbd>                 |
| Headings list          | <kbd>VO</kbd>+<kbd>U</kbd>, then headings                                          | <kbd>Insert</kbd>+<kbd>F7</kbd>             |
| Next heading, landmark | <kbd>VO</kbd>+<kbd>Cmd</kbd>+<kbd>H</kbd>; rotor for landmarks                     | <kbd>H</kbd>; <kbd>D</kbd>                  |

Use the production-like stack (`npm run stack:up`, <https://opspilot.localhost:3443>) or the demo environment. You need two browser profiles: one for **staff** (an Owner), one for an **attendee**.

**How to listen:**

- Use the keyboard and the screen reader's own navigation only, without looking.
- At each step, write down what you **heard**, not what you saw.
- **A problem** is anything you could not find, could not identify, or did not know had happened.

## The script

Each step lists what should be announced; the third column is for what you heard.

| #   | Step                                         | What should be announced                                                                                                                                                                                                             | Heard / problem |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| 1   | Open the sign-in page                        | Page title "Sign in · OpsPilot"; a heading; the fields "Email address" and "Password" by name; the button "Sign in"                                                                                                                  |                 |
| 2   | Sign in with a wrong password                | The error, at once, without moving focus (it is an alert)                                                                                                                                                                            |                 |
| 3   | Sign up, then land on Events                 | The new page's title; "Skip to content" as the first stop; the "Events" heading                                                                                                                                                      |                 |
| 4   | Use "Skip to content"                        | Focus on the main content, its heading next                                                                                                                                                                                          |                 |
| 5   | Navigate by headings and landmarks           | Header (banner), navigation, main; headings in order, none skipped                                                                                                                                                                   |                 |
| 6   | Create an event                              | Each field's label and any hint; on a mistake, the field's error announced with the field (described by it)                                                                                                                          |                 |
| 7   | Launch Control: readiness                    | The readiness score and each blocker, as text, not only colour; each "fix" action by name                                                                                                                                            |                 |
| 8   | Runbook: add and complete a task             | The task's name and state (critical, done); confirmation that it saved                                                                                                                                                               |                 |
| 9   | Stream: "Check now"                          | That a check is running, then its result (reachable or not), without hunting for it                                                                                                                                                  |                 |
| 10  | Holding slate: upload                        | The file control by name; "Uploading…", then the result                                                                                                                                                                              |                 |
| 11  | Access policy, then go live                  | Each option's label; the transition's result, or why it was refused                                                                                                                                                                  |                 |
| 12  | **Attendee:** the public page                | Title (the event's name); the event's time in your time zone; the form's fields and the consent checkbox with its wording                                                                                                            |                 |
| 13  | **Attendee:** register and verify            | "Check your inbox" (status) after registering; the verified state after the link                                                                                                                                                     |                 |
| 14  | **Attendee:** the watch page                 | The video by name, with its controls; Chat and Questions as headed regions                                                                                                                                                           |                 |
| 15  | **Attendee:** chat, while staff writes       | Each new message announced once, politely, while you stay where you are (the chat is a log region)                                                                                                                                   |                 |
| 16  | **Attendee:** ask a question, vote           | The question field by name; after asking, that it was sent (or awaits moderation); each vote button names its question ("Vote for: …")                                                                                               |                 |
| 17  | **Attendee:** questions others ask           | **Judge this one.** New questions are not announced: the list has no live region, because it reorders as votes come in. Is finding them by moving through the list enough, or does a polite "new question" announcement need adding? |                 |
| 18  | **Staff:** moderate (hide, pin, answer)      | Each action's result; a merged question announced as merged                                                                                                                                                                          |                 |
| 19  | **Staff:** the operations room               | An incident announced at once, assertively; audience and stream figures readable as text                                                                                                                                             |                 |
| 20  | **Staff:** end the event, open the report    | The report's headings; tables with headers read with each cell; the CSV export as a link or button by name                                                                                                                           |                 |
| 21  | Session revoked (staff revokes the attendee) | The attendee hears that their access ended, and is not left on a silent page                                                                                                                                                         |                 |

## Record

| Date | Who | Screen reader and browser | Where | Problems found | Fixed in |
| ---- | --- | ------------------------- | ----- | -------------- | -------- |
|      |     |                           |       |                |          |

Every problem goes into the audit's findings table ([accessibility-audit.md](accessibility-audit.md#findings-and-fixes)), with the criterion it fails and the fix, as for the earlier findings.
