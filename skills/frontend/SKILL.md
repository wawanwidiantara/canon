---
name: frontend
description: Build or change UI so it is consistent with the project's design system, usable in every state, and not generic. Use for any screen, component, style or copy change.
---

<!-- Adapted from the frontend-design skill in anthropics/skills (Apache-2.0): the design plan before code, the habit of naming the clichés, the copy rules and the quality floor. The stress and consistency ideas come from emilkowalski/skills (MIT) and the detector idea from pbakaus/impeccable (Apache-2.0). Written in this project's words. -->

An agent left alone builds the same interface every time. Do these in order. The brief or the design system always overrides anything below.

## 1. Start from a reference

- Start from something that exists, never a blank page. Take an existing screen in this app, a design file (a `.pen` or a Figma frame) or a screenshot, and say which one you follow.
- `canon query design-system` and `canon query --governs <path>` first. The spec for the screen holds the behaviors, states and widths already agreed.
- If the product, the audience and the one job of the screen are not in the spec or the brief, ask about those and only those. Look up everything else.

## 2. The design system

- It is one `context` doc per project. If `canon query design-system` finds none and the work is more than a one-off, create it: `canon new context <project> design-system`. Fill it with the color tokens (named by role), the type roles and scale, the spacing scale, radii and shadows, the components that exist, the voice, and a short list of what this product never does.
- Anchor it to the token file (the CSS variables, the Tailwind theme or the theme module) with `canon anchor`. When the tokens change under the doc, `canon stale` says so. Update the doc, then `canon verify`.
- Extend the tokens, never fork them. No raw colors, hex values or arbitrary sizes in components; use a token, or add one to the file and the doc together. A lint rule that bans raw values (stylelint, or `no-arbitrary-value` in the Tailwind plugin) beats this sentence, so add one if the project has none.
- Use a component that exists before you write a new one. Same thing, same look, same behavior, same place.

## 3. Plan the tokens first

For a new screen, write a short token plan before any code: four to six named colors, the type roles, and the layout as a plain-text sketch. Check it against the brief and against the tells below, change what is generic, and only then build. For a small edit inside an existing screen, skip this and follow its neighbors.

## 4. States, widths and real content

- Every screen covers empty, loading, error and success, and a no-permission state when roles exist. The spec names them; build all of them, not only the happy path.
- Check it at 375, 768 and 1280 pixels.
- Use real content. No lorem ipsum, no "John Doe", no dead buttons. Take the data from the same fixtures or mocks the app already uses.
- Make one choice bold and keep the rest quiet. Motion is sparse and answers a user action.

## Tells to avoid

- The default fonts (Inter, Roboto, Arial, the system stack) used everywhere without the design system choosing them.
- Purple-to-blue gradients, and gradient washes on cards.
- A grid of identical rounded cards with the same grey shadow.
- A rounded-square icon tile above every heading.
- Grey text on a colored background.
- Accenting one word of a headline.
- ALL-CAPS eyebrow labels, and a label above content that adds nothing.
- Middle-dot meta strings and an arrow on every link.
- Numbers like 01, 02, 03 on things that are not a sequence.
- A fade-and-slide-up on every section.
- Emoji used as icons.
- Stacked shadows, and borders where one would do.
- Lorem ipsum, or filler like "Unlock the power of".

## Copy

- Write from the user's side, in active voice and sentence case.
- One name per action, everywhere: "Save changes", not "Submit"; never Save here and Update there.
- An error says what happened and what to do next. An empty state invites an action.
- Labels are specific. A button says what it does.

## Accessibility floor

- A visible focus state on every control, and a full path by keyboard.
- Text contrast that passes WCAG AA; do not rely on color alone for meaning.
- Every input has a label. Images that carry meaning have text.
- Honor reduced motion: fewer and gentler, not none. Hover effects only where hover exists.
- On phones: inputs at 16 pixels or larger, touch targets large enough, and never disable zoom.

## Check it

- Run the project's own checks (`canon check`, the lint and token rules, and the gate).
- If the project runs browser tests, write or update them for the states and widths above, and run them. Do not add browser tests to a project that has not asked for them. The person decides per behavior: a browser test, or checking it by hand and closing it with `canon confirm`.
- Where you can render the page, take screenshots of the key states and read them against the design doc. Say which findings you saw in the rendered page and which you only inferred from the code; a model reading a screenshot misses small details.
- If the project's gate runs a design detector such as `npx impeccable detect`, fix what it reports. Turn its telemetry off in the project's config first.
- What only a person can judge, such as how it looks and feels, is theirs: say so and stop.

## Next

Run `ui-review` on the finished screen, then close the phase in `flow`.
