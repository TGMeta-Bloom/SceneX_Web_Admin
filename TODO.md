# TODO - SceneX_Web_Admin (Talent Ranking + Recommendations)

- [ ] Update `app.js` Model layer:
  - [ ] Add Firestore read helper for global profiles (fetch all profiles) for calibration counters.
  - [ ] Add Firestore availability check helper for a profile on a requestedDate (read profiles/{id}/unavailabilities/{YYYY-MM-DD} and check isBlocked).
- [ ] Update `app.js` AdminViewModel:
  - [ ] Add helper methods:
    - [ ] `computeWeightedScore({portfolioScore, skillsScore, experienceScore, completenessScore})`
    - [ ] `classifyVisibilityTier(score)` => FEATURED/NORMAL/LOW_VISIBILITY
    - [ ] `augmentProfileWithComputedMetrics(profileDoc)` (calculate S + tier; does not write)
    - [ ] `writeComputedVerificationAtomic(profileId, computed)` (transaction/update write of status + calculated_score + visibility_tier)
  - [ ] Modify calibration dashboard computation to use ALL profiles fetched from Firestore (not only pending).
  - [ ] Modify Approve flow to:
    - [ ] compute score using current slider weights
    - [ ] set visibility_tier
    - [ ] write `{status:'verified', calculated_score, visibility_tier}` atomically
  - [ ] Keep pending verification queue rendering unchanged: only show docs with status == 'pending_review'.
- [ ] Add recommendation simulation helper:
  - [ ] `recommendationSimulationFilterAndSort(allProfiles, targetCategory, targetSkill, requestedDate)`
    - [ ] Filter status == 'verified'
    - [ ] Match category + skills membership
    - [ ] Availability constraint via unavailabilities sub-collection and isBlocked
    - [ ] Sort by calculated_score (or recompute S) desc
- [x] Update `index.html`:
  - [x] Added “Smart Recommendations & Discovery” panel with inputs + results list.

- [ ] Run `npx serve .` and verify:
  - [ ] Calibration counters update
  - [ ] Approve writes status + computed fields
  - [ ] Tier classification is correct
  - [ ] Recommendation simulation helper returns expected sorted results

