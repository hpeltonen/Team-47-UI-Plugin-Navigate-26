# Access Arena

**Nobody gets offboarded in this tenant without earning it.**

Access Arena is a SailPoint Identity Security Cloud UI plugin. A manager picks one of their direct reports, and the two of them fight as stick figures, with procedurally generated avatars for heads, in a real-time canvas arena. Every stat in the fight comes from live identity data. If the manager wins, the plugin calls the real set-lifecycle-state API and moves the report to a new lifecycle state. If the manager loses, the report keeps every entitlement and the manager gets to try again next quarter.

Built for the SailPoint Developer Hack Day, UI Plugins track, by Team 47.

## The problem it solves

Offboarding is the most consequential lifecycle change in identity governance, and it is usually a single click on a form. Access Arena makes the weight of that decision visible. Before the bell rings, the manager sees exactly how entrenched the person is in the tenant, because that is literally what they are about to fight.

## How identity data becomes a fighter

Each fighter is loaded with one call to the Search API against the identities index.

| Identity data | In the arena |
| --- | --- |
| Entitlement count | Health. One entitlement is one hit point. Someone with 300 entitlements is a boss fight. |
| Role count | Armour. Every role absorbs one hit before health is touched. |
| Privileged access count | Weapon. Zero privileged access swings a wet noodle. A few swings a rolled-up policy document. Four or more swings a two-handed sword with longer reach. |
| Direct reports (manager only) | Minions. Each report is a tiny stick figure that runs in when the manager punches. |
| Accounts | Shown on the tale of the tape as what is at stake. |

The report is a bot whose aggression scales with its own privileged access.

## What happens on a win

1. The arena emits the winner.
2. The plugin calls `POST /v3/identities/{id}/set-lifecycle-state` with the lifecycle state the manager chose before the fight.
3. The page shows the before and after state and the account activity id ISC returns.
4. Any account actions configured on that lifecycle state run, exactly as if an admin had changed it.

Disabled lifecycle states are listed but cannot be chosen. Enable one on the identity profile and challenge again.

## SailPoint APIs used

| API | Purpose |
| --- | --- |
| Identities, `GET /v3/identities` | Loads the tenant, derives the manager list and each manager's direct reports. |
| Search, `POST /v3/search` | One identity document per fighter: entitlement, role and access profile counts, privileged access, accounts, identity profile, current lifecycle state. |
| Lifecycle States, `GET /v3/identity-profiles/{id}/lifecycle-states` | The states a defeated report can be moved to. |
| Lifecycle States, `POST /v3/identities/{id}/set-lifecycle-state` | The final blow. |

All calls go through the typed `@sailpoint/angular-sdk` services with the scoped token the UI Plugin SDK obtains from the App Shell handshake.

## Controls

| Key | Action |
| --- | --- |
| Left and right arrows, or A and D | Move |
| Space, or J | Punch |
| Shift, or K | Block. A blocked punch does a fifth of its damage. |

Click the arena once to give it keyboard focus. The round lasts sixty seconds. If the clock runs out, whoever has the larger share of health left wins.

## Project layout

| Path | What it is |
| --- | --- |
| `src/app/arena/game.ts` | The engine: fighters, physics, bot, particles, drawing, procedural avatars. Plain TypeScript with no Angular. |
| `src/app/arena/game.spec.ts` | Headless simulations of full bouts: a punching manager wins, roles absorb hits first, the clock ends a round, fighters stay inside the arena. |
| `src/app/arena/arena.component.ts` | Canvas host. Runs the animation loop and keyboard outside Angular's zone so sixty frames a second never trigger change detection. |
| `src/app/core/fighter-stats.service.ts` | Search, lifecycle state listing, and the set-lifecycle-state call. |
| `src/app/core/sailpoint-plugin.service.ts` | UI Plugin SDK wrapper from the starter. Handles the handshake and exposes context as signals. |
| `src/app/app.ts`, `src/app/app.html` | Page flow: pick a manager, challenge a report, tale of the tape, fight, verdict. |
| `sp-ui-plugin.json` | Plugin manifest. |

## Running it

Requirements: Node 24 or newer, the SailPoint CLI 2.7 or newer, and a personal access token with the `sp:scopes:all` scope.

```bash
npm install
```

Register the plugin in your tenant, then link your local dev server to your identity. Link prints a developer URL.

```bash
sail ui-plugins create
sail ui-plugins link
npm start
```

Open the developer URL in Chrome, Edge or Firefox while signed in to the tenant. The host loads your local code inside the live tenant with a real scoped token.

Without a tenant, `https://localhost:4200` boots in a failed-handshake state and offers a practice bout with made-up fighters so you can tune the fight.

### Tests

```bash
npm test
```

### Deploying

```bash
npm run build
sail ui-plugins upload
```

Then add a navbar item under Admin, Global, System Settings, Customize Navbar.

## Tenant prerequisites for a good demo

- Identities with managers set, otherwise the manager dropdown is empty.
- A lifecycle state other than Active enabled on the identity profile of the report you plan to challenge. Demo tenants usually ship with Terminated switched off.
- Sources attached to that state's Disable action if you want the K.O. to visibly cut access, not just change the state.

## Why there are no photos

Identity Security Cloud stores no profile pictures. Each head is drawn from a hash of the identity's email address, so the same person always gets the same face, with an initials badge so you can still tell who is who.

## Built with

Angular 21 standalone components and signals, PrimeNG with the SailPoint Design System theme, `@sailpoint/ui-plugin-sdk`, `@sailpoint/angular-sdk`, and a hand-rolled canvas game loop with no game or physics library.
