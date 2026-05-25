/*
  SceneX_Web_Admin - MVVM (Model + ViewModel)
  - View: index.html
  - Styles: styles.css
  - Model: Firebase v9/v10 compat CDN
  - ViewModel: AdminViewModel
*/

(function () {
  'use strict';

  /**
   * ==========================
   * MODEL
   * ==========================
   * Plain JS functions for Firebase read/write.
   */
  const SceneXModel = (() => {
    let app = null;
    let db = null;
    let calibrationColRef = null;
    let profilesColRef = null;

    // Cache for global profiles to support recommendation simulation
    let cachedAllProfiles = null;


    const log = (...args) => console.debug('[SceneXModel]', ...args);

    function getFirebaseConfigFromWindow() {
      // Expected shape:
      // window.SCENEX_FIREBASE_CONFIG = { apiKey, authDomain, projectId, ... }
      const cfg = window.SCENEX_FIREBASE_CONFIG;
      if (!cfg || typeof cfg !== 'object') return null;
      return cfg;
    }

    async function ensureFirebaseInitialized() {
      if (db) return { ok: true };

      // Compat CDN scripts expected to be loaded by the user. If not, we fail gracefully.
      const hasCompat = !!(window.firebase && window.firebase.firestore);
      if (!hasCompat) {
        return { ok: false, error: 'Firebase compat libraries not found. Include Firebase compat scripts or expose window.firebase.' };
      }

      const cfg = getFirebaseConfigFromWindow();
      if (!cfg) {
        return { ok: false, error: 'Missing window.SCENEX_FIREBASE_CONFIG. Provide your Firebase config to enable backend writes.' };
      }

      // Initialize app only once
      app = window.firebase.apps && window.firebase.apps.length ? window.firebase.app() : window.firebase.initializeApp(cfg);
      db = app.firestore();

      profilesColRef = db.collection('profiles');
      calibrationColRef = db.collection('ranking_calibration');

      return { ok: true };
    }

    /**
     * Real-time listener for profiles where status == pending_review.
     * Note: Firestore cannot execute in-memory filtering; this requires a field.
     */
    function listenPendingProfiles(onSnapshot, onError) {
      if (!profilesColRef) {
        throw new Error('Firebase not initialized. Call ensureFirebaseInitialized() first.');
      }

      const q = profilesColRef.where('status', '==', 'pending_review');
      const unsub = q.onSnapshot(
        (snap) => {
          const results = [];
          snap.forEach((doc) => {
            const data = doc.data() || {};
            results.push({ id: doc.id, ...data });
          });
          onSnapshot(results);
        },
        (err) => {
          onError && onError(err);
        }
      );

      return unsub;
    }

    /**
     * Approve: transaction-style update to overwrite flags.
     * CandidateData is optional extra fields.
     */
    async function approveProfile(profileId, candidateData = {}) {
      if (!db) throw new Error('Firebase not initialized');
      const profileRef = profilesColRef.doc(profileId);
      const now = Date.now();

      await db.runTransaction(async (tx) => {
        const doc = await tx.get(profileRef);
        if (!doc.exists) {
          throw new Error('Profile does not exist: ' + profileId);
        }

        tx.update(profileRef, {
          status: 'approved',
          moderatedAt: now,
          moderationDecision: 'approve',
          ...candidateData,
        });
      });

      return { ok: true };
    }

    async function rejectProfile(profileId) {
      if (!db) throw new Error('Firebase not initialized');

      const profileRef = profilesColRef.doc(profileId);
      const now = Date.now();

      await db.runTransaction(async (tx) => {
        const doc = await tx.get(profileRef);
        if (!doc.exists) throw new Error('Profile does not exist: ' + profileId);

        tx.update(profileRef, {
          status: 'rejected',
          moderatedAt: now,
          moderationDecision: 'reject',
        });
      });

      return { ok: true };
    }

    /**
     * Overwrite ranking weights.
     * Writes to 'ranking_calibration' collection.
     */
    async function writeCalibrationWeights(weights) {
      if (!db) throw new Error('Firebase not initialized');
      const now = Date.now();

      // Use a fixed doc id so it overwrites.
      const docId = 'active';
      await calibrationColRef.doc(docId).set(
        {
          portfolio: weights.portfolio,
          skills: weights.skills,
          experience: weights.experience,
          completeness: weights.completeness,
          updatedAt: now,
        },
        { merge: false }
      );

      return { ok: true };
    }

    async function fetchAllProfilesOnce() {
      if (!db) throw new Error('Firebase not initialized');
      // NOTE: unfiltered fetch (used for calibration preview + recommendation simulation)
      const snap = await profilesColRef.get();
      const results = [];
      snap.forEach((doc) => {
        const data = doc.data() || {};
        results.push({ id: doc.id, ...data });
      });
      return results;
    }

    async function isProfileBlockedOnDate(profileId, dateStr) {
      if (!db) throw new Error('Firebase not initialized');
      if (!dateStr) return false;

      // profiles/{profileId}/unavailabilities/{YYYY-MM-DD}
      const ref = profilesColRef.doc(profileId).collection('unavailabilities').doc(dateStr);
      const doc = await ref.get();
      if (!doc.exists) return false;
      const data = doc.data() || {};
      return !!data.isBlocked;
    }

    async function writeVerifiedProfileMetricsAtomic(profileId, computed) {
      if (!db) throw new Error('Firebase not initialized');
      const profileRef = profilesColRef.doc(profileId);
      const now = Date.now();

      // Atomic write using transaction to ensure the doc exists.
      await db.runTransaction(async (tx) => {
        const doc = await tx.get(profileRef);
        if (!doc.exists) throw new Error('Profile does not exist: ' + profileId);

        tx.update(profileRef, {
          status: 'verified',
          moderationDecision: 'approve',
          visibility_tier: computed.visibility_tier,
          calculated_score: computed.calculated_score,
          moderatedAt: now,
        });
      });

      return { ok: true };
    }

    async function injectTestCandidate(test) {
      if (!db) throw new Error('Firebase not initialized');

      const now = Date.now();
      const id = test && test.id ? String(test.id) : ('test_' + Math.random().toString(16).slice(2));

      const doc = profilesColRef.doc(id);

      const payload = {
        status: 'pending_review',
        moderatedAt: now,
        moderationDecision: 'pending',

        name: test?.name || 'Test Candidate',
        email: test?.email || 'test@example.com',

        // scoring inputs used by computeWeightedScoreForProfile
        portfolioScore: test?.portfolioScore ?? 80,
        skillsScore: test?.skillsScore ?? 80,
        experienceScore: test?.experienceScore ?? 80,
        completenessScore: test?.completenessScore ?? 80,

        // recommendation/category filters
        spotlight_category: test?.spotlight_category || 'Test Category',
        skills: Array.isArray(test?.skills) ? test.skills : ['TestSkill'],

        // optional showreel fields
        showreelUrl: test?.showreelUrl || '',
        physicalSpecs: test?.physicalSpecs || '—',

        createdAt: now,
        updatedAt: now,
      };

      await doc.set(payload, { merge: false });
      return { ok: true, id };
    }

    return {
      ensureFirebaseInitialized,
      listenPendingProfiles,
      approveProfile,
      rejectProfile,
      writeCalibrationWeights,
      fetchAllProfilesOnce,
      isProfileBlockedOnDate,
      writeVerifiedProfileMetricsAtomic,
      injectTestCandidate,
    };
  })();


  /**
   * ==========================
   * VIEWMODEL
   * ==========================
   */
  class AdminViewModel {
    constructor() {
      /** state */
      this.pendingProfiles = [];
      this.weights = {
        portfolio: 50,
        skills: 50,
        experience: 50,
        completeness: 50,
      };

      this.listenerUnsub = null;
      this.ui = {
        pendingProfilesGrid: document.getElementById('pendingProfilesGrid'),
        profilesEmpty: document.getElementById('profilesEmpty'),
        profilesMeta: document.getElementById('profilesMeta'),
        pendingCount: document.getElementById('pendingCount'),

        // calibration
        tabVerification: document.getElementById('tab-verification'),
        tabCalibration: document.getElementById('tab-calibration'),
        calibrationStatus: document.getElementById('calibrationStatus'),
        tierMeta: document.getElementById('tierMeta'),
        tierFeatured: document.getElementById('tierFeatured'),
        tierNormal: document.getElementById('tierNormal'),
        tierLow: document.getElementById('tierLow'),

        weightPortfolio: document.getElementById('weightPortfolio'),
        weightSkills: document.getElementById('weightSkills'),
        weightExperience: document.getElementById('weightExperience'),
        weightCompleteness: document.getElementById('weightCompleteness'),

        weightPortfolioLabel: document.getElementById('weightPortfolioLabel'),
        weightSkillsLabel: document.getElementById('weightSkillsLabel'),
        weightExperienceLabel: document.getElementById('weightExperienceLabel'),
        weightCompletenessLabel: document.getElementById('weightCompletenessLabel'),

        // topbar
        listenerStatus: document.getElementById('listenerStatus'),
        latencyMs: document.getElementById('latencyMs'),
        envLabel: document.getElementById('envLabel'),
      };

      // DOM ids
      this.btnApproveAll = document.getElementById('btnApproveAll');

      // Navigation + control buttons
      this.btnRefresh = document.getElementById('btnRefresh');
      this.btnExpandAll = document.getElementById('btnExpandAll');
      this.btnCollapseAll = document.getElementById('btnCollapseAll');
      this.btnResetWeights = document.getElementById('btnResetWeights');

      /** internal render callback */
      this.renderUI = this.renderUI.bind(this);
    }

    async init() {
      // environment label
      this.ui.envLabel.textContent = (window.location && window.location.hostname) ? window.location.hostname : 'local';

      // Wire view events
      this._wireTabNavigation();
      this._wireGlobalActions();
      this._wireVerificationCardActions();
      this._wireCalibrationSliders();
      this._wireResetWeights();
      this._wireRecommendationEngine();


      const t0 = performance.now();
      const initRes = await SceneXModel.ensureFirebaseInitialized();
      const t1 = performance.now();

      // Load global profiles once for calibration + discovery simulation.
      // This is used to compute preview counters based on ALL verified profiles.
      if (initRes.ok) {
        try {
          const all = await SceneXModel.fetchAllProfilesOnce();
          const normalized = Array.isArray(all) ? all : [];
          cachedAllProfiles = normalized;
          this.cachedAllProfiles = normalized;

          // DEBUG TOOL #1 (temporary)
          // Dump every profile's document id + actual `status` to the browser console.
          // Helps detect typos/casing issues like "pending review" vs "pending_review".
          console.group('[SceneX DEBUG] profiles/{id} status dump');
          normalized.forEach((p) => {
            const id = p && p.id;
            const status = p && p.status;
            console.log({ id, status });
          });
          console.groupEnd();

          // Extra: show unique status values.
          const uniqueStatuses = Array.from(new Set(normalized.map((p) => (p && p.status) || null)));
          console.log('[SceneX DEBUG] unique status values:', uniqueStatuses);
        } catch (e) {
          console.error('[AdminViewModel] fetchAllProfilesOnce failed:', e);
          this.cachedAllProfiles = [];
        }
      }


      if (!initRes.ok) {
        this.ui.listenerStatus.textContent = 'Firebase disabled';
        this.ui.listenerStatus.classList.add('text-danger');
        this.ui.calibrationStatus.textContent = 'Configure Firebase to enable writes.';
        this.ui.latencyMs.textContent = '—';
        this._setCalibrationTierToEmpty();
        // still render empty state
        this.pendingProfiles = [];
        this.renderUI();
        return;
      }

      this.ui.latencyMs.textContent = `${Math.round(t1 - t0)}ms`;

      // Listener
      this.ui.listenerStatus.textContent = 'Listening…';
      this._startPendingProfilesListener();
    }

    _startPendingProfilesListener() {
      if (this.listenerUnsub) this.listenerUnsub();

      const t0 = performance.now();
      try {
        this.listenerUnsub = SceneXModel.listenPendingProfiles(
          (profiles) => {
            const t1 = performance.now();
            this.ui.latencyMs.textContent = `${Math.round(t1 - t0)}ms`;
            this.ui.listenerStatus.textContent = 'Live';

            this.pendingProfiles = Array.isArray(profiles) ? profiles : [];
            this.renderUI();
          },
          (err) => {
            console.error(err);
            this.ui.listenerStatus.textContent = 'Listener error';
            this.ui.listenerStatus.classList.add('text-danger');
          }
        );
      } catch (e) {
        console.error(e);
        this.ui.listenerStatus.textContent = 'Listener not started';
        this.ui.listenerStatus.classList.add('text-danger');
      }
    }

    _wireTabNavigation() {
      document.querySelectorAll('[data-tab-target]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const targetSel = btn.getAttribute('data-tab-target');
          const target = targetSel ? document.querySelector(targetSel) : null;
          if (!target) return;

          // active link
          document.querySelectorAll('#sideNav .app-navlink').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');

          // show/hide tabs
          const allTabs = document.querySelectorAll('.tab-pane');
          allTabs.forEach((s) => s.classList.add('d-none'));
          target.classList.remove('d-none');
        });
      });

      // default: show verification, hide calibration
      const t1 = document.getElementById('tab-verification');
      const t2 = document.getElementById('tab-calibration');
      if (t1 && t2) {
        t1.classList.remove('d-none');
        t2.classList.add('d-none');
      }
    }

    _wireGlobalActions() {
      this.btnRefresh?.addEventListener('click', () => {
        // Snapshot is already realtime; manual refresh toggles listener rebind.
        this.ui.listenerStatus.textContent = 'Refreshing…';
        if (this.listenerUnsub) {
          this.listenerUnsub();
          this.listenerUnsub = null;
        }
        this._startPendingProfilesListener();
      });

      this.btnExpandAll?.addEventListener('click', () => {
        document.querySelectorAll('[data-collapsible="profile"]').forEach((el) => {
          el.classList.remove('collapsed-body');
          el.style.maxHeight = el.scrollHeight + 'px';
        });
      });

      this.btnCollapseAll?.addEventListener('click', () => {
        document.querySelectorAll('[data-collapsible="profile"]').forEach((el) => {
          el.classList.add('collapsed-body');
          el.style.maxHeight = '0px';
        });
      });
    }

    _wireVerificationCardActions() {
      // Event delegation on grid
      this.ui.pendingProfilesGrid?.addEventListener('click', async (e) => {
        const approveBtn = e.target.closest('[data-action="approve"]');
        const rejectBtn = e.target.closest('[data-action="reject"]');
        if (!approveBtn && !rejectBtn) return;

        const card = e.target.closest('[data-profile-card="true"]');
        const profileId = (card && card.getAttribute('data-profile-id')) || null;
        if (!profileId) return;

        // disable to prevent double submits
        const btns = card.querySelectorAll('button');
        btns.forEach((b) => (b.disabled = true));

        const prevMeta = this.ui.profilesMeta.textContent;
        this.ui.profilesMeta.textContent = 'Applying moderation write…';

        try {
          if (approveBtn) {
            // Pull the full profile doc data (needed for score computation).
            const cached = Array.isArray(this.cachedAllProfiles) ? this.cachedAllProfiles.find((p) => p && p.id === profileId) : null;
            const profileForCompute = cached || {};

            // Compute score + visibility tier using current slider weights.
            const computed = this._computeAndClassifyProfileComputedMetrics(profileForCompute);

            // Atomically mark verified + persist computed outputs.
            await SceneXModel.writeVerifiedProfileMetricsAtomic(profileId, computed);
          }


          if (rejectBtn) {
            await SceneXModel.rejectProfile(profileId);
          }

          // listener will update; still render for immediate feedback
          this.ui.profilesMeta.textContent = `Updated ${profileId}. Waiting for live refresh…`;
        } catch (err) {
          console.error(err);
          this.ui.profilesMeta.textContent = 'Write failed. Check Firebase config / rules.';
          this.ui.profilesMeta.classList.add('text-danger');
          setTimeout(() => {
            this.ui.profilesMeta.textContent = prevMeta;
            this.ui.profilesMeta.classList.remove('text-danger');
          }, 2500);

          // re-enable buttons
          btns.forEach((b) => (b.disabled = false));
          return;
        }
      });
    }

    _wireCalibrationSliders() {
      const sliders = [
        { el: this.ui.weightPortfolio, key: 'portfolio', label: this.ui.weightPortfolioLabel },
        { el: this.ui.weightSkills, key: 'skills', label: this.ui.weightSkillsLabel },
        { el: this.ui.weightExperience, key: 'experience', label: this.ui.weightExperienceLabel },
        { el: this.ui.weightCompleteness, key: 'completeness', label: this.ui.weightCompletenessLabel },
      ];

      sliders.forEach((s) => {
        s.el?.addEventListener('input', () => {
          const v = Number(s.el.value);
          this.weights[s.key] = Number.isFinite(v) ? v : 0;
          this._syncCalibrationLabels();

          // compute tier stats based on placeholder preview scores
          this._computeTierSegmentsFromAllVerified();
        });

        // On change, persist to backend (explicit backend write before render)
        s.el?.addEventListener('change', async () => {
          const payload = { ...this.weights };
          await this._persistCalibrationWeights(payload);
          this.renderUI();
        });
      });

      // initial UI sync
      this._syncCalibrationLabels();
      this._computeTierSegmentsFromAllVerified();

    }

    async _persistCalibrationWeights(payload) {
      try {
        if (!window.firebase || !window.firebase.firestore) {
          this.ui.calibrationStatus.textContent = 'Firebase not configured. Cannot write calibration.';
          return;
        }
        this.ui.calibrationStatus.textContent = 'Writing calibration weights…';
        await SceneXModel.writeCalibrationWeights(payload);

        // Refresh cachedAllProfiles so calibration counters/discovery use newest state.
        try {
          const all = await SceneXModel.fetchAllProfilesOnce();
          this.cachedAllProfiles = Array.isArray(all) ? all : [];
        } catch (e) {
          console.warn('[AdminViewModel] refresh cache failed:', e);
        }

        this.ui.calibrationStatus.textContent = `Calibration saved (${payload.portfolio}/${payload.skills}/${payload.experience}/${payload.completeness}).`;
      } catch (err) {
        console.error(err);
        this.ui.calibrationStatus.textContent = 'Calibration write failed. Check Firebase rules.';
      }
    }


    _wireResetWeights() {
      this.btnResetWeights?.addEventListener('click', async () => {
        const payload = { portfolio: 50, skills: 50, experience: 50, completeness: 50 };
        this.weights = payload;


        if (this.ui.weightPortfolio) this.ui.weightPortfolio.value = payload.portfolio;
        if (this.ui.weightSkills) this.ui.weightSkills.value = payload.skills;
        if (this.ui.weightExperience) this.ui.weightExperience.value = payload.experience;
        if (this.ui.weightCompleteness) this.ui.weightCompleteness.value = payload.completeness;

        this._syncCalibrationLabels();
        this._computeTierSegmentsFromAllVerified();
        await this._persistCalibrationWeights(payload);
        this.renderUI();
      });
    }

    _wireRecommendationEngine() {
      const btn = document.getElementById('btnRunRecommendationEngine');

      // Optional: if backend score recalculation is triggered by UI later,
      // you can wire it here without touching HTML IDs.

      const recalcBtn = document.getElementById('btnRecalculateScores');
      if (recalcBtn) {
        recalcBtn.addEventListener('click', async () => {
          recalcBtn.disabled = true;
          try {
            await this.recalculateAllTalentScores();
          } finally {
            recalcBtn.disabled = false;
          }
        });
      }
      const inputCategory = document.getElementById('recTargetCategory');
      const inputSkill = document.getElementById('recTargetSkill');
      const inputDate = document.getElementById('recRequestedDate');
      const meta = document.getElementById('recMeta');
      const latency = document.getElementById('recLatency');
      const empty = document.getElementById('recResultsEmpty');
      const list = document.getElementById('recResultsList');

      if (!btn || !inputCategory || !inputSkill || !inputDate || !list) return;

      btn.addEventListener('click', async () => {
        const targetCategory = (inputCategory.value || '').trim();
        const targetSkill = (inputSkill.value || '').trim();
        const requestedDate = inputDate.value || '';

        list.innerHTML = '';
        empty?.classList.add('d-none');

        if (!targetCategory || !targetSkill || !requestedDate) {
          meta.textContent = 'Please fill Target Category, Required Skill, and Audition Date.';
          return;
        }

        meta.textContent = 'Running recommendation simulation…';
        latency.textContent = '—';

        const t0 = performance.now();
        try {
          // Ensure we have global cache.
          if (!Array.isArray(this.cachedAllProfiles) || this.cachedAllProfiles.length === 0) {
            const all = await SceneXModel.fetchAllProfilesOnce();
            this.cachedAllProfiles = Array.isArray(all) ? all : [];
          }

          const matches = await this.recommendationSimulationFilterAndSort(this.cachedAllProfiles, targetCategory, targetSkill, requestedDate);

          const t1 = performance.now();
          latency.textContent = `${Math.round(t1 - t0)}ms`;

          if (!matches || matches.length === 0) {
            empty?.classList.remove('d-none');
            meta.textContent = 'No matches for the selected inputs/date.';
            return;
          }

          meta.textContent = `Found ${matches.length} match(es) — sorted by calculated_score.`;

          for (const m of matches) {
            const li = document.createElement('li');
            li.className = 'list-group-item bg-transparent border-dark-subtle';
            const badgeClass = (m.visibility_tier === 'FEATURED') ? 'band-featured'
              : (m.visibility_tier === 'NORMAL') ? 'band-normal'
              : 'band-low';

            li.innerHTML = `
              <div class="d-flex align-items-center justify-content-between gap-3">
                <div>
                  <div class="fw-semibold">${(() => {
                    const hasName = (m && m.name != null && String(m.name).trim() !== '');
                    if (hasName) return this._escapeHtml(m.name);
                    const ghostId = (m && m.id) ? m.id : '—';
                    const label = `[GHOST: ${ghostId}]`;
                    return `<span style="color: #EF4444; font-weight: 800;">${this._escapeHtml(label)}</span>`;
                  })()}</div>
                  <div class="small text-muted">${this._escapeHtml(m.spotlight_category || '—')} • ${this._escapeHtml(String((m.skills || []).join(', ')))}</div>
                </div>
                <div class="text-end">
                  <div class="badge ${badgeClass}" style="font-weight:800; font-size:12px;">${Math.round(m.calculated_score)}%</div>
                  <div class="small text-muted">${this._escapeHtml(m.visibility_tier)}</div>
                </div>
              </div>
            `;
            list.appendChild(li);
          }
        } catch (e) {
          console.error(e);
          meta.textContent = 'Recommendation engine failed. Check Firestore rules / availability documents.';
        }
      });
    }

    _syncCalibrationLabels() {

      const w = this.weights;
      this.ui.weightPortfolioLabel.textContent = `${w.portfolio}%`;
      this.ui.weightSkillsLabel.textContent = `${w.skills}%`;
      this.ui.weightExperienceLabel.textContent = `${w.experience}%`;
      this.ui.weightCompletenessLabel.textContent = `${w.completeness}%`;
    }

    _setCalibrationTierToEmpty() {
      if (!this.ui.tierFeatured) return;
      this.ui.tierMeta.textContent = '—';
      this.ui.tierFeatured.textContent = '0';
      this.ui.tierNormal.textContent = '0';
      this.ui.tierLow.textContent = '0';
    }

    /**
     * Tier segments:
     * Featured = 85+, Normal = 50-84, Low <50
     * We compute a preview score from available candidate metrics if present.
     */
    _computeTierSegmentsFromAllVerified() {
      const all = Array.isArray(this.cachedAllProfiles) ? this.cachedAllProfiles : [];
      const verified = all.filter((p) => p && p.status === 'verified');

      if (verified.length === 0) {
        this._setCalibrationTierToEmpty();
        this.ui.tierMeta.textContent = '0 verified talents';
        this.ui.calibrationStatus.textContent = this.ui.calibrationStatus?.textContent || '—';
        return;
      }

      let featured = 0, normal = 0, low = 0;
      for (const p of verified) {
        const computed = this._computeAndClassifyProfileComputedMetrics(p);
        if (computed.visibility_tier === 'FEATURED') featured++;
        else if (computed.visibility_tier === 'NORMAL') normal++;
        else low++;
      }

      this.ui.tierFeatured.textContent = String(featured);
      this.ui.tierNormal.textContent = String(normal);
      this.ui.tierLow.textContent = String(low);
      this.ui.tierMeta.textContent = `${verified.length} verified talents • tier preview`;
    }


    /**
     * RenderUI - updates DOM based on state.
     */
    renderUI() {
      const grid = this.ui.pendingProfilesGrid;
      const empty = this.ui.profilesEmpty;

      if (!grid) return;

      const count = this.pendingProfiles.length;
      this.ui.pendingCount.textContent = String(count);

      if (count === 0) {
        empty?.classList.remove('d-none');
      } else {
        empty?.classList.add('d-none');
      }

      // Calibration status/tier preview
      this._computeTierSegmentsFromAllVerified();


      // Render cards
      grid.innerHTML = '';

      for (const profile of this.pendingProfiles) {
        const id = profile.id;
        // Profile docs may be partially populated; normalize to safe strings.
        const hasGhostName = !(profile && profile.name != null && String(profile.name).trim() !== '');
        const name = hasGhostName ? `<span style="color: #EF4444; font-weight: 800;">[GHOST: ${this._escapeHtml(id)}]</span>` : profile.name;
        const email = (profile && profile.email != null && profile.email !== '') ? profile.email : '—';
        const physicalSpecs = (profile && (profile.physicalSpecs != null || profile.physical != null))
          ? (profile.physicalSpecs ?? profile.physical)
          : '—';


        // YouTube showreel link (unlisted) placeholder; use a field if available.
        // Accept either full URL or { showreelUrl }
        const showreelUrl = profile.showreelUrl || profile.showreel || '';

        // Extract YouTube video id if possible
        const videoId = this._extractYouTubeId(showreelUrl);
        const iframeSrc = videoId ? `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1&autoplay=0` : 'about:blank';

        const scorePreview = this._previewScoreForCard(profile);

        const card = document.createElement('div');
        card.className = 'col-12 col-xl-6';
        card.setAttribute('data-profile-card', 'true');
        card.setAttribute('data-profile-id', id);

        // Collapsible content placeholder for expand/collapse
        card.innerHTML = `
          <div class="card scene-card shadow-sm h-100">
            <div class="card-body p-3 p-md-4">
              <div class="d-flex align-items-start justify-content-between gap-3 mb-3">
                <div>
                  <div class="text-muted small">Candidate • <span class="fw-semibold">${id}</span></div>
                  <div class="h5 mb-0">${this._escapeHtml(name)}</div>
                  <div class="small text-muted">Preview score: <span class="fw-semibold">${Math.round(scorePreview)}</span></div>
                </div>
                <div class="d-flex flex-column align-items-end gap-2">
                  <span class="muted-chip px-2 py-1 rounded-3 small">pending_review</span>
                  <div class="small text-muted">Realtime</div>
                </div>
              </div>

              <div class="row g-2 mb-3">
                <div class="col-12 col-md-6">
                  <label class="form-label small text-muted">Name</label>
                  <div class="form-control bg-transparent border border-dark-subtle text-white-50" aria-readonly="true">${this._escapeHtml(name)}</div>
                </div>
                <div class="col-12 col-md-6">
                  <label class="form-label small text-muted">Email</label>
                  <div class="form-control bg-transparent border border-dark-subtle text-white-50" aria-readonly="true">${this._escapeHtml(email)}</div>
                </div>
                <div class="col-12">
                  <label class="form-label small text-muted">Physical specs</label>
                  <div class="form-control bg-transparent border border-dark-subtle text-white-50" aria-readonly="true">${this._escapeHtml(String(physicalSpecs))}</div>
                </div>
              </div>

              <div class="mb-3">
                <label class="form-label small text-muted">Showreel (unlisted YouTube)</label>
                <iframe class="player-iframe" 
                  src="${iframeSrc}"
                  title="Showreel player"
                  frameborder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowfullscreen>
                </iframe>
              </div>

              <div class="d-flex flex-wrap gap-2 justify-content-end">
                <button class="btn btn-success" type="button" data-action="approve">Approve</button>
                <button class="btn btn-outline-danger" type="button" data-action="reject">Reject</button>
              </div>

              <!-- internal collapsible marker for expand/collapse hooks -->
              <div data-collapsible="profile" style="overflow:hidden; transition:max-height .18s ease; max-height: 260px;" class="mt-3">
                <div class="text-muted small">Moderation actions update Firestore status flags and trigger real-time listener refresh.</div>
              </div>
            </div>
          </div>
        `;

        grid.appendChild(card);
      }

      // If nothing shown, ensure empty state
      if (grid.children.length === 0) {
        empty?.classList.remove('d-none');
      }
    }

    computeWeightedScoreForProfile(profile, weights) {
      const w = weights || this.weights;
      const weightsSum = (Number(w.portfolio) || 0) + (Number(w.skills) || 0) + (Number(w.experience) || 0) + (Number(w.completeness) || 0);
      const div = weightsSum || 1;

      const portfolio = Number(profile.portfolioScore ?? profile.portfolio ?? 50);
      const skills = Number(profile.skillsScore ?? profile.skills ?? 50);
      const experience = Number(profile.experienceScore ?? profile.experience ?? 50);
      const completeness = Number(profile.completenessScore ?? profile.completeness ?? 50);

      return (portfolio * w.portfolio + skills * w.skills + experience * w.experience + completeness * w.completeness) / div;
    }

    classifyVisibilityTier(score) {
      const s = Number.isFinite(score) ? score : 0;
      if (s >= 85) return 'FEATURED';
      if (s >= 50) return 'NORMAL';
      return 'LOW_VISIBILITY';
    }

    _computeAndClassifyProfileComputedMetrics(profile) {
      const calculated_score = this.computeWeightedScoreForProfile(profile, this.weights);
      const visibility_tier = this.classifyVisibilityTier(calculated_score);
      return { calculated_score, visibility_tier };
    }

    _previewScoreForCard(profile) {
      return this.computeWeightedScoreForProfile(profile, this.weights);
    }

    async recommendationSimulationFilterAndSort(allProfiles, targetCategory, targetSkill, requestedDate) {
      const verified = (Array.isArray(allProfiles) ? allProfiles : []).filter((p) => p && p.status === 'verified');

      const matches = [];
      for (const p of verified) {
        const spotlightCategory = (p.spotlight_category || '').trim();
        const skills = Array.isArray(p.skills) ? p.skills : [];

        if (!spotlightCategory || spotlightCategory !== targetCategory) continue;
        if (!skills.includes(targetSkill)) continue;

        // Availability constraint: if unavailabilities/{requestedDate}.isBlocked == true => exclude
        let blocked = false;
        try {
          blocked = await SceneXModel.isProfileBlockedOnDate(p.id, requestedDate);
        } catch (e) {
          console.warn('[Recommendation] availability check failed for', p.id, e);
        }
        if (blocked) continue;

        const computed = this._computeAndClassifyProfileComputedMetrics(p);
        matches.push({ ...p, calculated_score: computed.calculated_score, visibility_tier: computed.visibility_tier });
      }

      matches.sort((a, b) => Number(b.calculated_score) - Number(a.calculated_score));
      return matches;
    }


    _extractYouTubeId(url) {

      if (!url) return null;
      const s = String(url).trim();

      // If already an id (heuristic)
      if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;

      // Common patterns
      const patterns = [
        /youtu\.be\/([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
      ];
      for (const p of patterns) {
        const m = s.match(p);
        if (m && m[1]) return m[1];
      }
      return null;
    }

    _escapeHtml(str) {
      return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '<')
        .replaceAll('>', '>')
        .replaceAll('"', '"')
        .replaceAll("'", '&#039;');
    }

    /**
     * Recalculate all talent scores using current slider weights.
     * Uses Firebase v9+ Modular SDK (dynamic imports) and writes with writeBatch.
     */
    async recalculateAllTalentScores() {
      // Fetch current slider weights from the View.
      const wP = Number(document.getElementById('weight-portfolio')?.value);
      const wS = Number(document.getElementById('weight-skills')?.value);
      const wE = Number(document.getElementById('weight-experience')?.value);
      const wC = Number(document.getElementById('weight-completeness')?.value);

      const weights = {
        portfolio: Number.isFinite(wP) ? wP : 0,
        skills: Number.isFinite(wS) ? wS : 0,
        experience: Number.isFinite(wE) ? wE : 0,
        completeness: Number.isFinite(wC) ? wC : 0,
      };

      const sum = (weights.portfolio + weights.skills + weights.experience + weights.completeness);
      if (!sum) {
        console.warn('[recaculateAllTalentScores] sum of weights is 0, aborting');
        return { ok: false, reason: 'weights_sum_is_zero' };
      }

      // Modular SDK imports
      const {
        getDocs,
        collection,
        query,
        where,
        writeBatch,
        doc,
      } = await import('https://www.gstatic.com/firebasejs/9.24.0/firebase-firestore.js');

      const appModule = await import('https://www.gstatic.com/firebasejs/9.24.0/firebase-app.js');
      // Prefer a global app if already initialized by compat, but we still need modular Firestore.
      const firebaseCfg = window.SCENEX_FIREBASE_CONFIG;
      if (!firebaseCfg) {
        console.warn('[recalculateAllTalentScores] Missing window.SCENEX_FIREBASE_CONFIG');
        return { ok: false, reason: 'missing_firebase_config' };
      }

      // Initialize modular app (idempotent)
      const modularApp = (() => {
        // If the app.js already initialized compat, we cannot reuse directly for modular.
        // Use modular initializeApp with same config; Firebase prevents duplicates.
        return appModule.initializeApp(firebaseCfg);
      })();

      const { getFirestore } = await import('https://www.gstatic.com/firebasejs/9.24.0/firebase-firestore.js');
      const firestore = getFirestore(modularApp);

      try {
        const profilesRef = collection(firestore, 'profiles');
        const talentsQ = query(profilesRef, where('role', '==', 'talent'));
        const snap = await getDocs(talentsQ);

        const batch = writeBatch(firestore);
        let ops = 0;

        snap.forEach((profileDoc) => {
          const data = profileDoc.data() || {};

          const portfolioScore = Number(data.portfolioScore ?? data.portfolio ?? 0);
          const skillsScore = Number(data.skillsScore ?? data.skills ?? 0);
          const experienceScore = Number(data.experienceScore ?? data.experience ?? 0);
          const completenessScore = Number(data.completenessScore ?? data.completeness ?? 0);

          const score = ((portfolioScore * weights.portfolio) +
            (skillsScore * weights.skills) +
            (experienceScore * weights.experience) +
            (completenessScore * weights.completeness)) / sum;

          let visibility_tier = 'LOW_VISIBILITY';
          if (score >= 85) visibility_tier = 'FEATURED';
          else if (score >= 50) visibility_tier = 'NORMAL';

          batch.update(doc(firestore, 'profiles', profileDoc.id), {
            calculated_score: score,
            visibility_tier,
            rankingCalculatedAt: Date.now(),
          });

          ops++;
        });

        await batch.commit();
        console.debug('[recalculateAllTalentScores] committed ops:', ops);
        return { ok: true, updated: ops };
      } catch (e) {
        console.error('[recalculateAllTalentScores] failed:', e);
        return { ok: false, error: e };
      }
    }
  }


  // Start app
  document.addEventListener('DOMContentLoaded', () => {
    // --- Admin Login handler (Firebase compat SDK) ---

    // Runs only on pages that contain the login form markup.
    const loginFormEl = document.querySelector('form');
    const loginEmailEl = document.getElementById('loginEmail');
    const loginPasswordEl = document.getElementById('loginPassword');
    const isLoginPage = !!(loginEmailEl && loginPasswordEl && loginFormEl);

    // If this page doesn't look like the admin login page, skip wiring.
    if (isLoginPage) {

      const injectAlert = (message) => {
        // Bootstrap alert markup (works even if Bootstrap isn't loaded).
        // We still use alert classes for consistency with your existing UI stack.
        let host = document.getElementById('adminAuthAlertHost');
        if (!host) {
          host = document.createElement('div');
          host.id = 'adminAuthAlertHost';
          loginFormEl.insertAdjacentElement('beforebegin', host);
        }

        host.innerHTML = `
          <div class="alert alert-danger d-flex flex-column gap-1" role="alert" style="margin-bottom: 12px; border-radius: 14px;">
            <div class="fw-semibold">${message}</div>
          </div>
        `;
      };

      const clearAlert = () => {
        const host = document.getElementById('adminAuthAlertHost');
        if (host) host.innerHTML = '';
      };

      const handleAdminLogin = async (email, password) => {
        try {
          // Ensure compat global is ready (some browsers can delay script execution)
          const startWait = Date.now();
          while (typeof window.firebase === 'undefined' && Date.now() - startWait < 5000) {
            await new Promise((r) => setTimeout(r, 50));
          }

          if (!window.firebase) {
            throw new Error('Firebase compat not loaded (window.firebase is undefined).');
          }

          const auth = window.firebase.auth();
          const db = window.firebase.firestore();

          // 1) Log in
          const cred = await auth.signInWithEmailAndPassword(email, password);
          const uid = cred.user.uid;

          // 2) Check role
          const docSnap = await db.collection('profiles').doc(uid).get();
          const data = docSnap.exists ? docSnap.data() : {};

          if (docSnap.exists && data.role === 'admin') {
            window.location.href = 'dashboard.html';
          } else {
            await auth.signOut();
            injectAlert('Access Denied: Unauthorized Administrator Account.');
          }
        } catch (error) {
          console.error('Login error:', error);
          injectAlert('Login Failed: ' + error.message);
        }
      };

      const triggerLogin = async () => {
        clearAlert();

        const email = (loginEmailEl.value || '').trim();
        const password = loginPasswordEl.value || '';

        if (!email || !password) {
          injectAlert('Please enter your email and password.');
          return;
        }

        await handleAdminLogin(email, password);
      };

      // Submit handler (works if the button is changed to type="submit" later)
      loginFormEl.addEventListener('submit', async (e) => {
        e.preventDefault();
        await triggerLogin();
      });

      // Click handler (current markup uses type="button", so submit may never fire)
      const loginBtn = loginFormEl.querySelector('button[type="button"], button[type="submit"], button');
      if (loginBtn) {
        loginBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          await triggerLogin();
        });
      }
    }

    // Expose temporary debug helper to the page console.

    // Usage:
    //   window.injectTestCandidate()
    // or
    //   window.injectTestCandidate({ id: 'abc', name: 'X', skills: ['Improv'], spotlight_category: 'Actor' })
    window.injectTestCandidate = async (test = {}) => {
      try {
        const res = await SceneXModel.injectTestCandidate(test);
        console.log('[SceneX DEBUG] injectTestCandidate wrote:', res);
        // Listener should update automatically.
        return res;
      } catch (e) {
        console.error('[SceneX DEBUG] injectTestCandidate failed:', e);
        throw e;
      }
    };

    // Only run the MVVM dashboard logic when the dashboard view exists.
    // This avoids null DOM lookups on the login page.
    const shouldInitDashboard = !!document.getElementById('pendingProfilesGrid');
    if (shouldInitDashboard) {
      const vm = new AdminViewModel();
      vm.init().catch((e) => {
        console.error(e);
        const el = document.getElementById('listenerStatus');
        if (el) {
          el.textContent = 'Init failed';
          el.classList.add('text-danger');
        }
      });
    }
  });


})();

