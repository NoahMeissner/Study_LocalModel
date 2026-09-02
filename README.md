# Study_LocalModel

Participant-facing rating platform for the LARP human study ("Can a Local Model
Solve this?"). Static: `index.html` + `style.css` + `app.js`, served by GitHub Pages.

Math in prompts renders with a vendored KaTeX (`katex/`, v0.16.47). The prompt CSV
must carry math between `\( \)` (inline), `\[ \]` or `$$ $$` (display) delimiters;
bare `$` is deliberately not a delimiter so dollar amounts in prompts stay text.
