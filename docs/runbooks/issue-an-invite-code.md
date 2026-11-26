# Issue or withdraw an invite code

**When:** someone (an interviewer, a client trying GoLiveBoard) should be able to create their own workspace on a deployment where sign-up is by invitation (FR-WS-1); or a code they were given should stop working.

The API reads `SIGN_UP_CODES`: comma-separated `label:sha256` entries, the SHA-256 digests of the codes, each with a short lower-case label naming who it was given to. Only the digests are stored, so reading the parameter does not reveal a code. Unset, anyone can sign up (local development and tests); set, sign-up needs one of the codes, and the web form asks for it. Sign-ups are limited to 10 an hour per address, which also limits guesses at a code.

## Symptoms

- Someone needs an account and you want them to have their own workspace, not the shared demo.
- A code was shared further than intended, or its holder no longer needs it.
- `403 SIGN_UP_CODE_INVALID` for a code that should work.

## Checks

1. **What is in force?** The log line `sign-up with an invite code` carries the label of each code used (Loki in AWS: `{service="api"} |= "signUpCode"`).
2. **In AWS:** `aws ssm get-parameter --name /goliveboard/demo/SIGN_UP_CODES --with-decryption --query Parameter.Value --output text` lists the labels in force.

## Actions

### Issue a code

1. Make a code that cannot be guessed, and its digest:

   ```sh
   code="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
   printf '%s\n' "$code"                                   # give this to the person
   printf '%s' "$code" | shasum -a 256 | cut -d' ' -f1     # store this
   ```

2. Choose a label: lower case, digits and hyphens, up to 40 characters, not used yet (`acme-interview`).
3. **Locally:** add `SIGN_UP_CODES=acme-interview:<digest>` to `.env` and restart the API (`npm run stack:up` on the production-like stack). Also restart the web server, so the form shows the field.
4. **In AWS:** add the entry to the SecureString parameter `/goliveboard/demo/SIGN_UP_CODES`, after a comma if there are others (create it on first use, by hand: never through Terraform or CI, docs/runbooks/rotate-a-secret.md). Then redeploy the current release, because the host reads parameters at each deploy: **Actions → Deploy → Run workflow**, with **sha** set to the release running now ([Deploy and roll back](deploy-and-roll-back.md)).
5. Send the code to the person by a channel only they read. Do not keep a copy.

### Withdraw a code

Remove its entry from the parameter and redeploy, as above. Accounts already created stay; to remove one too, its workspace's Owner can be disabled (docs/01, FR-WS-4). Removing the whole parameter opens sign-up to everyone.

## Verification

- Without a code, or with a wrong one, the sign-up form shows **That invite code is not valid** and no account is created.
- With the new code, sign-up works, and the API log shows its label.
- After a withdrawal, the old code gets the error.

## Rehearsals

| Date | Where | Result |
| ---- | ----- | ------ |
