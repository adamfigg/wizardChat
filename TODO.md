# WizardChat to-do

## Set aside for now

- [ ] **Connect Gmail so verification codes are really e-mailed**

  The site's side is finished and was tested against a local test mail
  server. What remains needs your Google account:

  1. Turn on 2-Step Verification at https://myaccount.google.com/security
  2. Create an app password named `WizardChat` at
     https://myaccount.google.com/apppasswords and copy the 16 letters
     (Google shows them once).
  3. In `.env`, fill in `SMTP_USER` (your Gmail address), `SMTP_PASS` (the
     app password), `MAIL_FROM` (`"WizardChat <your Gmail address>"`), and
     `ADMIN_EMAIL` (the address you will sign up with). Leave `SMTP_HOST`
     and `SMTP_PORT` as they are.
  4. Run `npm run mail:test your-address` and check that the message arrives.
  5. Restart the site and confirm it prints `Mail: connected to smtp.gmail.com`.
  6. Sign up a second, ordinary account through the site to see the whole
     flow work. (Your own Steward account already exists: it was made with
     `npm run member`, so it needs no code.)

  **Until this is done, nobody new can sign up.** `.env` names Gmail as the
  mail server but has no login, so codes are neither sent nor shown. To try
  sign-up in the meantime, empty the `SMTP_HOST=` line in `.env` and
  restart: codes are then printed in the terminal where the server runs.
  Put `smtp.gmail.com` back at step 3.

## Later

- [ ] **Steward tools for managing members**: add, remove, and restrict
      accounts. (For now, `npm run member` can add one from the terminal.)
- [ ] **Changing your own passphrase from the site.** Your Steward account
      uses a generated one; until this exists, `npm run member -- --email
      your-address --reset-passphrase` issues a fresh one.

## Mini-games that grant resources

A working list; add to it freely. None of these is started.

Each game is to be very short and easy to accomplish, and grants resources
(gold, attunement, knowledge, power) when completed. Which game grants which
resource, and how much, is not yet decided. As with everything else that
pays, the server decides the reward (`src/ledger.js`), never the browser.

- [ ] Blow the dust off the tomes
- [ ] Polish the orbs
- [ ] Ponder the orb
- [ ] Light the candles that have burnt out
- [ ] Shake up the potions
- [ ] Pick the matching hat and cloak
- [ ] Shoo the goblins away
- [ ] Levitate the large object onto the shelf
- [ ] Trim the wizard's beard
- [ ] Feed the man-eating plant
- [ ] Smoke the pipe
- [ ] Wizard battle

For a later time:

- [ ] Pixelated animations for each game
- [ ] A bounty for completing 5 mini-games (the bounty board is ready for
      it; it waits only on there being games to complete)

## Larger features

Ideas noted for later. None of these is started.

- [ ] **Gambling with points.** Begun: the Back Alley has one game, the
      Wheel of Fate. Further games of chance are still to come.
- [ ] **Pets that come from portals.** Each one is random, and there are
      rare versions.

Other things not built yet are listed at the end of `README.md`.
