# Working rules

## Commit in small pieces, as you go

Do not batch a whole phase of work into one commit. Every commit has to be a
milestone you could describe in a sentence, and it has to leave the repo in a
state that is still worth having.

The unit of work is small and concrete:

- one bug fix
- one testid or one small group of related testids
- one E2E suite (`teams.spec.ts`, `goals.spec.ts`, ...)
- one piece of test infrastructure (`ladders-auth.ts`, `ladders-data.ts`)

Commit right after the change works, before moving to the next item. Do not
leave a finished stage uncommitted "to do it all at the end".

Never commit a failing test. If a new test exposes a bug, commit the fix first
and the test right after, so each commit is green on its own.

## Never push `ladders` or `e2e-tests`

Commit locally, stop there. Pushing is a separate, explicit decision from the
user. `main` is canonical; only the `ui` repo gets published.

## Secrets

Test credentials live in the keychain as `ladders-test-account:email` and
`ladders-test-account:password`, exported as `LADDERS_TEST_EMAIL` and
`LADDERS_TEST_PASSWORD` from `~/.zshrc`. Never read them with a shell builtin
that prints them, never write them into a repo file, and never paste them into
a commit or a summary.