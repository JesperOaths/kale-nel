# GEJAST Visual / Box Layout Note v142

## Current homepage visual direction
- Ladder cards at the top are the right direction.
- No extra title above them; the live badge should sit centered in the translucent top block.
- Public box order should stay:
  1. Account Aanmaken
  2. Login
  3. Klaverjas Invoeren
  4. Boerenbridge Invoeren
  5. Beerpong Invoeren
  6. Spelers
- The bottom vote/Legends/Losers area is visually good and should be preserved.
- The watermark style is good; only the version number needs to keep updating correctly.

## Plus icon direction
- Use the plus icon instead of text in the three Invoeren cards.
- Keep it visible but not dominant.
- Current target: larger than the tiny version, with 75% opacity.

## Live badge direction
- Use a blinking red live-style badge.
- Center it in the translucent top block so it does not overlap the logo.
- If ladder data fails to load, show an offline/stand-by state instead.

## Admin hub direction
- Keep the grouped admin-hub layout.
- Reuse the current admin session across admin tools.
- Avoid repeated login prompts when a valid admin session already exists.

## Data storage direction
- Keep both normalized columns and raw payload JSON wherever match input provides useful data.
- Do not silently throw away useful input stats from any of the three game forms.

## Script delivery preference
- Deliver full updated scripts, not tiny excerpt-only fixes.
