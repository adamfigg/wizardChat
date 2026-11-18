# WizardChat

A gathering place for practitioners of the Art: a feed of posts with images and
recordings, a classified notice board, and an archive of practical advice.

Anyone may read. Posting, responding, reacting, and placing notices require an
account with a verified e-mail address. The Attunement (the discipline quiz)
is optional; members who have not taken it appear as Wanderers.

## Running it

Requires Node.js 22.13 or newer (it uses Node's built-in SQLite).

```
npm install
npm start
```

Then open http://localhost:3000. Use `npm run dev` to restart automatically when files change.

| Command           | What it does                                                        |
| ----------------- | ------------------------------------------------------------------- |
| `npm start`       | Runs the site                                                       |
| `npm run dev`     | Runs the site and restarts on file changes                          |
| `npm run build`   | Rebuilds the browser scripts after a change in `client/`            |
| `npm run seed`    | Adds five demonstration members with posts and notices              |
| `npm run balance` | Shows how often each discipline is assigned across all quiz answers |
| `npm run mail:test you@example.com` | Sends a test message using the mail settings in `.env` |
| `npm run member -- --email you@example.com --name "Your Name" --steward` | Creates a confirmed member without sending an e-mail (see below) |
| `npm run grant -- --name "Their Name" --gold 1000` | Gives a member currency (`--gold`, `--attunement`, `--knowledge`, `--power`, or `--all` for every one). Entered in the ledger as a Steward's grant |

### Creating a member by hand

`npm run member` makes an account whose address is already confirmed, for use
by the site's owner on the machine that holds the database. Add `--steward`
to make the member a Steward. Run it again with the same `--email` to rename
the member (`--name`) or to replace a lost passphrase (`--reset-passphrase`).

The passphrase is generated for you and written to a file in `data/`, never
shown on screen. Open the file, log in, then delete it.

## Configuration

Settings live in `.env` (a template is in `.env.example`). `.env` holds
secrets: git ignores it, and it must never be committed or shared.

- **E-mail.** See "Sending real e-mail" below.
- **Moderator.** Set `ADMIN_EMAIL` to your own address *before* you sign up.
  The account that verifies with that address becomes a Steward and can
  remove any post, comment, or notice.
- **Going live.** Set `NODE_ENV=production` (HTTPS-only cookies) and
  `TRUST_PROXY=1` if the host puts a proxy in front of the app.

## Sending real e-mail

With `SMTP_HOST` empty, nothing is sent: each message and its code is printed
in the terminal where the server runs. To send real mail you need an account
with a mail provider, whose details go in `.env`:

| Provider | `SMTP_HOST` | `SMTP_PORT` | `SMTP_USER` | `SMTP_PASS` | `MAIL_FROM` |
| --- | --- | --- | --- | --- | --- |
| Gmail (quickest; no domain needed) | `smtp.gmail.com` | `587` | your full Gmail address | a 16-character **app password** (not your Gmail password) | your Gmail address |
| Resend (needs your own domain) | `smtp.resend.com` | `587` | `resend` | an API key | an address at your verified domain |
| Brevo (domain optional) | `smtp-relay.brevo.com` | `587` | the SMTP login Brevo shows | the SMTP key Brevo shows | a sender you verified with Brevo |

Confirm the values against the provider's own SMTP page, as they change from
time to time. Any other provider that offers SMTP works the same way.

**Gmail** is the fastest way to send to real inboxes today: switch on 2-Step
Verification for the Google account, create an app password at
https://myaccount.google.com/apppasswords, and paste it in as `SMTP_PASS`.
Mail arrives from your Gmail address, and Google limits it to roughly 500
messages a day, so it suits testing and a small circle, not a public launch.

**A provider with your own domain** is the proper arrangement for a public
site. The provider gives you three DNS records to add at your domain
registrar, and each matters for reaching the inbox instead of the spam folder:

- **SPF** lists which servers may send mail for your domain.
- **DKIM** signs each message so the recipient can prove it was not altered.
- **DMARC** tells recipients what to do with mail that fails those checks.

After editing `.env`:

```
npm run mail:test you@example.com
```

That sends one test message and explains any failure. Then restart the site;
on start it reports `Mail: connected to ...` when the settings are good.

The connection to the mail server is always encrypted (TLS 1.2 or newer) and
the server's certificate is checked. If encryption cannot be established, the
message is not sent.

## Where things are

```
server.js              App setup: security headers, view helpers, route mounting
src/db.js              Database tables (SQLite file at data/wizardchat.db)
src/auth.js            Passwords, sessions, CSRF, verification codes, rate limits
src/mailer.js          Sends e-mail over encrypted SMTP (or prints it, in development)
src/uploads.js         Image/video upload rules and checks
src/classes.js         The five disciplines, the quiz, and the scoring weights
src/orb.js             The Attunement orb's captions and spiral outlines
src/ledger.js          The four currencies: what earns them, and what each member holds
src/bounties.js        The bounties: the tasks, their rewards, and three at a time
src/council.js         The Council of Wizards: motions, votes, and settling them
src/wheel.js           The Back Alley's wheel: stake, spin, and payout
src/sigils.js          The sigils (reactions) a post may be given
src/shop.js            The Emporium's stock and prices; buying; who owns what
src/portraits.js       The ten portraits, two for each discipline
src/articles.js        The Advice Archive's articles (add new ones here)
src/routes/account.js  Sign-up, verification, login, the Attunement
src/routes/hall.js     Posts, sigils (reactions), comments
src/routes/addresses.js  The Steward's Address (featured articles atop the Hall)
src/routes/board.js    The Notice Board: bounties, and members' notices beneath
src/routes/archive.js  The Advice Archive
src/routes/emporium.js The Emporium (the shop)
src/routes/council.js  The Council of Wizards
src/routes/alley.js    The Back Alley
src/routes/profile.js  Member pages and profile card settings
views/                 Page templates (EJS)
public/css/style.css   All styling, including the five profile card frames
client/                Browser scripts as written (see "Browser scripts" below)
public/js/             Their built form; made by `npm run build`, not edited by hand
public/img/portraits/  The portrait drawings (SVG)
```

### Browser scripts

Pages are plain HTML and CSS, and every page works with scripts switched
off. Two small scripts add motion on top:

| Source | Built file | What it does | Packages |
| --- | --- | --- | --- |
| `client/sparkle.jsx` | `public/js/sparkle.js` | Sparkles on the banner inviting Wanderers to take the Attunement, and in the beam of light over each item in the Emporium (anything marked `data-sparkle`) | React, `react-sparkle` |
| `client/attunement.js` | `public/js/attunement.js` | Changes Attunement question without loading a page: the answered question slides out left, the next slides in from the right, and the orb fades to its next state | `torph` |

Browsers cannot load npm packages directly, so `npm run build` bundles each
source file with the packages it uses. Run it whenever you change a file in
`client/`. Neither script runs its motion for visitors whose device asks for
reduced motion.

`torph` animates text changing from one wording to another. It is used for
the two pieces of text that stay on screen between questions: the
"Question 3 of 9" count and the line beneath the orb. The slide itself is a
few lines in `client/attunement.js` (torph does not move blocks of a page).

### Why pages do not flash white between visits

Three things, all in place:

- `<meta name="color-scheme" content="dark">` in `views/partials/header.ejs`
  tells the browser the page is dark before the stylesheet has arrived, so
  the blank moment between two pages is dark.
- `@view-transition` at the top of `public/css/style.css` has the browser
  keep the old page on screen until the new one is ready, then fade between
  them (Chrome, Edge, Safari).
- The stylesheet and scripts are linked as `style.css?v=...` (the `asset`
  helper in `server.js`). The version changes when the file does, so the
  browser may keep its copy for a year and asks the server for nothing when
  moving between pages.

### One exception in the security policy

The site's Content-Security-Policy forbids styles written into a page.
`torph` adds a small stylesheet of its own when it starts, so each response
carries a random one-time value (a "nonce") and `client/attunement.js`
attaches it to that stylesheet. Nothing else may use inline styles.

Member data lives in `data/` and uploaded files in `uploads/`. Back up both.
To wipe the site and start over, stop the server and delete those two folders.

## How accounts work

1. **Sign-up** stores the member as unverified and e-mails a 6-digit code.
   The code lasts 15 minutes, allows 5 wrong guesses, can be re-sent once a
   minute, and at most 5 are sent to one address per hour. Only a hash of the
   code is stored. The visitor is **not** logged in at this point; they hold
   only a "pending" cookie.
2. **Verification** marks the address as real and only then starts a login
   session. An unverified sign-up can be redone, and is discarded after a day.
3. **An address that already belongs to a member** cannot be used again, but
   the sign-up page does not say so. The visitor sees the ordinary
   verification page, on which no code will work, and the existing member is
   sent an e-mail telling them what happened. This stops strangers from
   using the sign-up form to discover who is a member.
4. **Passphrases** need 10 or more characters, may not be among the most
   common ones or the member's own name or address, and are stored only as
   scrypt hashes. Login gives one message for every kind of failure.
5. **The Attunement** is optional. Until a member takes it they are a
   **Wanderer** with a grey granite card frame, and a banner at the top of
   every page invites them to take it. It asks nine questions, one to a
   page, and each answer is saved as it is given, so a member may go back or
   leave and resume. A crystal orb beside the question fills and quickens
   with every answer (it is drawn entirely in CSS; see "The orb" in
   `public/css/style.css`). After the ninth answer the member confirms, and
   only then is a discipline assigned. Each answer awards points to one or
   more disciplines (`src/classes.js`); the highest total wins, and ties are
   settled deterministically from the answers. Across all 9,216 possible
   answer combinations each discipline is assigned 19–22% of the time.
6. The discipline sets the member's **profile card** frame. Under their name
   in the masthead a member chooses the card's inscription, portrait, and
   adornments (see "The profile cards" below).

## The four currencies

Every member holds some amount of **gold**, **attunement**, **knowledge**, and
**power**, shown as four small figures at the top right of every page. They
are spent at the Emporium (below).

The server is the only authority on what a member holds (`src/ledger.js`):

- **The browser never states an amount.** No page or form can ask for
  currency. A route on the server confirms that something happened and then
  pays the member itself, by a rule in the `RULES` table.
- **Nothing is paid twice.** Each payment is a row in the `ledger` table
  recording the rule and the particular thing it was for, and the database
  refuses a second row for the same member, rule, and thing. Reloading a
  page or repeating a request earns nothing more.
- **A balance is never stored.** What a member holds is the sum of their
  rows, worked out from the database each time a page is drawn. There is
  nothing in a cookie or in the page for a member to alter.
- **Spending cannot go below nothing.** `spend()` checks the balance and
  records the cost in one transaction. The Emporium is what calls it.

What earns currency at present. These are a first set, meant to be changed;
each is one line in `RULES`:

| Currency | Earned by | Amount |
| --- | --- | --- |
| Gold | The first visit of each day while logged in (days are counted in UTC) | 5 |
| Attunement | Completing the Attunement | 10, once |
| Knowledge | Opening an article of the Advice Archive | 1 for each article, once |
| Power | Another member placing a sigil on one of your posts | 1 for each member on each post, at most 20 a day |

Power is not taken back when a sigil is withdrawn, so withdrawing and
replacing one earns nothing. To add a new way of earning, add a rule to
`RULES` and call `ledger.award(memberId, 'rule-name', whatItWasFor)` in the
route where the server confirms the action.

## Bounties

The Notice Board (`/notices`) opens with the member's bounties: small tasks,
each paying 1 to 25 of one currency according to how much it asks. Members'
own notices follow beneath.

Every member holds three bounties at a time. When all three are fulfilled,
three more are issued at once, of different sorts where possible. There is
no limit to how many sets a member may work through in a day.

| Bounty | Reward |
| --- | --- |
| Visit another member's page | 1 attunement |
| Place any sigil on another member's post | 2 power |
| Place a named sigil on another member's post | 3 power |
| Open an article of the Archive | 3 knowledge |
| Respond to another member's post (20 characters or more) | 5 attunement |
| Post a notice on the board | 6 gold |
| Share a post using a given word, such as "goblin" (40 characters or more) | 8 gold |
| Open 3 different articles | 8 knowledge |
| Share a post with an image or recording | 10 gold |
| Place sigils on 5 different posts by other members | 10 power |
| Respond to 3 different posts by other members | 14 attunement |
| Share a post of 400 characters or more using a given word | 25 knowledge |

The words a post may be asked to use are the `WORDS` list in the same file.

Nothing is claimed by the member. A bounty is fulfilled when a route on the
server sees the thing done and calls `bounties.mark(...)`; the member is told
on the next page. Only what is done after a bounty was issued counts, the
same post or article is never counted twice, a member's own posts do not
count for sigils or responses, and nobody is issued a bounty the site cannot
yet satisfy (one needing five posts by others when there are only two). The
reward is fixed when the bounty is issued and paid once through the ledger.

To add a sort of bounty, add an entry to `KINDS`. "Complete 5 mini-games" is
noted there but not offered, since there are no mini-games yet.

## The Council of Wizards

At `/council`, a Steward lays **motions**: a matter, between two and six
outcomes to vote for, and how long voting stays open (a quarter of an hour
to seven days). Members vote; a Steward may also close a vote early or
withdraw a motion that is still open.

When a vote closes, the outcome with the most votes is carried and every
member who voted for it is paid 25 of a resource chosen at random for each of
them. Outcomes level at the top are carried jointly and both sides are paid.
A motion nobody voted on lapses. Votes close by themselves: the server checks
every half minute, and before drawing any page that shows the Council's
business.

The result appears on a **scroll at the left of the Gathering Hall**, with
the vote now open beneath it (the one closing soonest). The scroll is absent
until the first motion is laid.

So that the reward cannot be had by simply joining the leading side
(`src/council.js`):

- a member has one vote on each motion and cannot change it;
- how the votes are falling is shown to nobody, Stewards included, until
  the vote has closed; only the number of votes cast is shown;
- the server pays the reward when it settles the vote, once for each member.

## The Back Alley

At `/alley`: games of chance, kept by a Broker. For now there is one, the
**Wheel of Fate** (`src/wheel.js`):

1. The member presses "Test Your Fate". The server takes from them between 1
   and 25 of one resource. Which resource and how much are chosen at random
   from what they hold, and taken at once, so a member who dislikes the stake
   cannot walk away and try again. Only one turn may be in progress.
2. The member names one of the four resources.
3. Only then does the server decide where the wheel rests. If it rests on
   the resource named, the stake is paid back twofold; otherwise it is kept.

The wheel turning on the page decides nothing; it shows a result already in
the database. With four resources a member wins one turn in four, and so on
average loses half of everything staked.

## The Emporium

The shop, at `/emporium`: a Purveyor and his stock of adornments for the
profile card. Pointing at an item brings a beam of light down on it, with the
same sparkles as the Attunement banner.

| Item | Kind | Price |
| --- | --- | --- |
| The Gilt Border | Border (replaces the discipline's frame) | 1,000 gold |
| The Crimson Storm | Border (red lightning) | 1,000 power |
| The Winged Eye | Charm (sits in the corner of the card) | 1,000 knowledge |

The stock is the `WARES` list in `src/shop.js`. The page sends only which
item is wanted; the price and the member's balance are looked up on the
server, and a purchase is a single ledger row, so an item cannot be bought
twice or without the means. What a member owns is read from those rows.

To add an item: add it to `WARES`, draw it in `views/partials/adornment.ejs`,
and style it under "Adornments" in `public/css/style.css`.

## The profile cards

A member sets three things under **Your Profile Card** (`/settings`), and the
server accepts only what that member may actually have:

- **Inscription.** One of the member's own Attunement answers. Those from
  the first five questions are open from the start; the other four are shown
  as sealed (`OPEN_INSCRIPTIONS` in `src/classes.js`). Members can no longer
  write their own.
- **Portrait.** One of the two portraits of their discipline
  (`src/portraits.js`), or their initial. Members can no longer upload a
  portrait. One uploaded earlier stays until its owner chooses another.
- **Adornments.** Whatever they have bought at the Emporium: one border and
  one charm at a time.

Nothing yet opens a sealed inscription or grants further portraits; that
awaits the rules for progress.

The colours behind each card move. Two layers of soft patches in the card's
own colours lie beneath the name and turn slowly in opposite directions, so
the colours appear to mix (`.card::before` and `.card::after` in
`public/css/style.css`; each kind of card supplies its patches as `--flow-a`
and `--flow-b`). The Warlock's frame moves as well: red streaks travel round
the green outline in both directions. All of it holds still for visitors
whose device asks for reduced motion.

## The Steward's Address

A Steward (the member whose address is `ADMIN_EMAIL` in `.env`) can publish
articles that set the direction of discussion. The newest one is featured at
the top of the Gathering Hall; long ones show their opening paragraphs with a
"Continue reading" link. All of them are kept at `/addresses`.

When logged in as a Steward, links to compose, amend, and withdraw appear on
the Hall and on each Address. Write in plain text: a blank line starts a new
paragraph, and a line beginning with `## ` becomes a sub-heading.

`ADMIN_EMAIL` may be set before or after the account is created; it takes
effect the next time that member logs in (restart the site after editing `.env`).

## Not built yet

Password reset, changing e-mail address, phone-number verification, reporting
of posts, editing after posting, and private messages.
