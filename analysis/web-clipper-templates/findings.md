# Findings: Web Clipper templates and their value for note-to-note derivation

Answers Q23 (from [tech.md](../../spec/obsidian-inference-machine/tech.md)): which Web Clipper templates have value, and can they be adapted to Obsidian Inference Machine's use cases?

Reviewed in October 2026:
- the 12 templates in [kepano/clipper-templates](https://github.com/kepano/clipper-templates) (MIT), the de-facto reference set by Obsidian's CEO, tuned for [his vault](https://github.com/kepano/kepano-obsidian)
- Web Clipper's built-in default template (`createDefaultTemplate` in `src/managers/template-manager.ts`)
- the [Interpreter](https://obsidian.md/help/web-clipper/interpreter) documentation's prompt-variable examples

## Summary

- **None of the templates can be imported and used as they are.** Every one gets its data from the web page through `{{url}}`, `{{selector:…}}`, `{{schema:…}}`, `{{meta:…}}` or page-level `{{title}}`/`{{description}}`/`{{content}}`, and most also depend on URL `triggers`. A vault note has none of these, so after a field-by-field import nearly every property would resolve to empty. Not supporting Web Clipper template import (Q23) is confirmed.
- **The templates' value lies in three things they teach us**, two of which apply directly:
  1. **Notes in a vault often are Web Clipper clippings.** Web Clipper's default template writes `title`, `source`, `author`, `published`, `created`, `description` and `tags: clippings` into `Clippings/`. Many source notes will carry exactly those properties. Built-in templates can read them and carry them over (Q26).
  2. **A shared property vocabulary.** The templates reuse the same typed properties: `categories` as a link to a hub note (`[[Books]]`, `[[Movies]]`), `author`/`director`/`cast` as wikilinked lists, `created: {{date}}`, `source` as a URL, an empty `rating` left for the user, and default `tags`. Our built-ins should follow the same conventions, so derived notes sit alongside clipped notes naturally.
  3. **Entity "reference note" templates (books, movies, places, products, recipes)** become possible for note-to-note use once inline prompt variables exist (Q24). A note that mentions a book could yield a book reference note whose properties are filled by inline prompts, so `author: {{"the book's author"|wikilink}}` stands in for the selector. That's adaptable, but the model may invent facts the note doesn't contain (Q27).

## Template-by-template assessment

| Template | What it captures | How it gets the data | Value for us | Adaptable? |
|---|---|---|---|---|
| **Default** (built into Web Clipper) | title, source, author, published, created, description, `clippings` tag, page content as Markdown | page variables | **High.** It defines the frontmatter most clipped source notes have. | Not as a template, but as **input**: built-ins should read `source`, `author`, `published` and `description` from the source note (Q26). |
| **Recipes** | ingredients and instructions as task lists, nutrition table, cuisine, author, publisher | `schema:@Recipe` structured data | **Medium.** Recipes are a common clipping type, and clipped or hand-typed recipes are often messy. | **Yes, with Q24.** A "Recipe card" template: inline prompts extract ingredients and steps into `- [ ]` lists from a rough recipe note. Low invention risk, because everything comes from the note. |
| **Product** | name, price, description, image, `[[Products]]` | `schema:@Product`, meta tags | Low. | Partly. Price and images aren't in a typical note, and inventing them would be wrong. |
| **arXiv** | paper title, authors, publish date, year, arXiv ID, full text | selectors, URL parsing | **Medium.** A clipped paper is a typical Literature note source. | **Already covered** by the Literature note built-in. Worth taking its `author` (wikilinked list) and `year` properties into Literature note when the source note has them. |
| **Wikipedia** | article as Markdown, `[[Wikipedia]]` author, clippings tags | selectors | Low as a template, but clipped Wikipedia articles are common sources. | Covered by Comprehensive summary or Key points. |
| **ChatGPT** | a shared AI conversation as Markdown turns | selectors | **Medium.** People paste or clip AI conversations into notes and later want the outcome, not the transcript. | **Yes:** a derivation such as "Conversation → decisions and takeaways" is plausible, but Comprehensive summary and Action items already cover most of it. Not a separate built-in. |
| **YouTube** | video embed, channel, upload date, thumbnail | `schema:` VideoObject | Low. A clipping has no transcript, which is what the YouTube summarizer used. | No. |
| **Goodreads** | book: title, author, genre, pages, year, ISBN, cover, score, `[[Books]]`, `books, to-read` | selectors | **Medium** as an entity pattern. | **With Q24, as a "Book reference" example:** title, author and genre from inline prompts. Pages, ISBN, cover and score would have to be invented, so they're left out or left empty. |
| **IMDB** / **IMDB reference** / **Letterboxd** | movie: genre, director, cast, year, plot, cover, scores, `[[Movies]]` | `schema:` / selectors | Medium (same entity pattern). | Same as Goodreads: a "Movie reference" example with inline prompts. Scores and covers are left out. |
| **Google Maps** / **Redfin** | place or home: address, coordinates, price, sqft, `[[Places]]` | selectors, URL parsing | Low. Coordinates and prices aren't in notes. | Only as a "Place reference" example (name, type, location as written in the note). Mostly not worth it. |

## What the property conventions suggest for our built-ins

These shape the design of the built-in templates in REQ-15. They're recommendations, decided in Q26.

- **Literature note:**
  - `source: {{source}}`, `author: {{author}}`, `published: {{published}}` carried over from the source note when present.
  - Typed as Web Clipper types them (`text`, `multitext`, `date`).
  - Empty properties are dropped rather than written blank.
- **All built-ins:** `created: {{date}}`, matching every template in the reference set.
- **Not adopted as a default:** `categories: [[…]]` hub links. They're specific to kepano's vault conventions and not universal.

## Recommendations

| ID | Recommendation |
|---|---|
| Q23 | **Answered by these findings:** don't import Web Clipper templates. Nothing would survive the mapping. |
| Q26 | Make the built-ins "clipping-aware": read Web Clipper's default properties (`source`, `author`, `published`, `description`) from the source note when present, and follow Web Clipper's typed-property conventions. This needs no inference and costs nothing when the properties are absent. |
| Q27 | Ship the adaptable entity templates (**Recipe card**, **Book reference**, **Movie reference**) as importable **example templates** in the repository and documentation, using inline prompts (Q24). They're not built-ins, which keeps the built-in set focused and keeps invention-prone templates opt-in. Their prompts tell the model to leave a property empty rather than guess. |
