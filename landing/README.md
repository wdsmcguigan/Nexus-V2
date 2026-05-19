# Nexus landing page

Self-contained static page deployed to GitHub Pages from the `main` branch.
The Actions workflow lives at `.github/workflows/pages.yml`.

## Local preview

```bash
# from repo root
cd landing
python3 -m http.server 8765
# open http://localhost:8765
```

## Editing styles

Tailwind utility classes are compiled to `tailwind.css` from `index.html`.
CI rebuilds this file on every deploy, so you don't have to.

If you want to preview locally after changing Tailwind classes:

```bash
cd landing
npx tailwindcss@3.4.15 -c tailwind.config.cjs -i tailwind.src.css -o tailwind.css --minify
```

Theme tokens (oklch colors, shadows, radii) live inline at the top of
`index.html` and mirror `src/design-system/tokens.css`. Edit them there
if the app's design system shifts.

## Tally form setup

The waitlist embeds a Tally form. To wire it up:

1. Create a form at <https://tally.so>.
2. Tally → Share → Embed → copy the form ID (e.g. `mO5VlA`).
3. In `index.html`, replace `TALLY_FORM_ID` with that ID.

Until then, the page shows a fallback with a mailto and a GitHub-issue link.
