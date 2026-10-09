# Morning Box — working agreement

Philosophy: **Make breakfast selection smarter, simpler, and faster, with minimum effort and maximum relevance.**

1. **Simplicity first** — clean, intuitive, no unnecessary complexity.
2. **Minimum user effort** — fewest possible questions, clicks and decisions.
3. **Smart personalization** — simple interactions, relevant recommendations.
4. **Seamless experience** — smooth and fast from first interaction to order confirmation.
5. **Consistent brand identity** — approved logo, colours, typography and MB-DSN-001 standards (Style-2 is the visual reference).
6. **MVP-first** — essentials and reliability before extra features.
7. **Meaningful differentiation** — never a food-ordering marketplace; intelligence, personalization and convenience make the difference.
8. **Consistency & transparency** — follow the locked MB-*-001 standards; discuss any significant change (new/removed step, feature, or departure from a standard) before implementing it. Flag placeholder content (names, prices, numbers) openly.

## Engineering rules
- `src/domain/engine.js`, `library.js`, `recipes.js`, `standards.js` implement the locked standards — do not change them without approval.
- The server is the source of truth: every order is re-validated and re-priced in `server/rules.js`. Never trust client prices or eligibility.
- One primary action per screen; reuse `src/components/ui.jsx` and `src/styles.css` rather than new styles.
- Before handing over: `npm test` and `npm run build` must pass.
