// dashboard-viewmodel.js
const DashboardViewModel = (() => {
  let currentTab = 'home'; 
  let cachedProfilesList = []; 
  let globalVerifiedProfilesCache = []; 

  function getElements() {
    return {
      totalTalents: document.getElementById('count-total-talents'),
      verifiedRecruiters: document.getElementById('count-verified-recruiters'),
      pendingReviews: document.getElementById('count-pending-reviews'),
      featuredProfiles: document.getElementById('count-featured-profiles'),
      container: document.getElementById('pending-reviews-container'),
      simCategory: document.getElementById('sim-target-category'),
      simSkill: document.getElementById('sim-target-skill'),
      simDate: document.getElementById('sim-target-date'),
      simWrapper: document.getElementById('sim-results-wrapper'),
      simGrid: document.getElementById('sim-output-grid'),
      tabHomePanel: document.getElementById('tab-content-home'),
      tabRankingsPanel: document.getElementById('tab-content-rankings'),
      viewTitle: document.getElementById('dynamic-view-title'),
      queueTitle: document.getElementById('queue-display-title'),
      rankingsPreviewGrid: document.getElementById('rankings-preview-grid'),
      wPortfolio: document.getElementById('weight-portfolio'),
      wSkills: document.getElementById('weight-skills'),
      wExperience: document.getElementById('weight-experience'),
      wCompleteness: document.getElementById('weight-completeness'),
      lblPortfolio: document.getElementById('lbl-wPortfolio'),
      lblSkills: document.getElementById('lbl-wSkills'),
      lblExperience: document.getElementById('lbl-wExperience'),
      lblCompleteness: document.getElementById('lbl-wCompleteness'),
      tFeatured: document.getElementById('threshold-featured'),
      tNormal: document.getElementById('threshold-normal'),
      btnRecalc: document.getElementById('btn-recalc')
    };
  }

  function switchTab(tabId) {
    currentTab = tabId;
    const ui = getElements();
    
    if (tabId === 'home') {
      ui.tabHomePanel?.classList.replace('hidden', 'block');
      ui.tabRankingsPanel?.classList.replace('block', 'hidden');
      if (ui.viewTitle) ui.viewTitle.textContent = "Operations Overview";
    } else if (tabId === 'rankings') {
      ui.tabHomePanel?.classList.replace('block', 'hidden');
      ui.tabRankingsPanel?.classList.replace('hidden', 'block');
      if (ui.viewTitle) ui.viewTitle.textContent = "Ranking & Thresholds Management Page";
      recalculateRankingsOverview(); 
    } else {
      ui.tabHomePanel?.classList.replace('hidden', 'block');
      ui.tabRankingsPanel?.classList.replace('block', 'hidden');
      if (tabId === 'talents') {
        if (ui.viewTitle) ui.viewTitle.textContent = "Talent Moderation Workspace";
      } else if (tabId === 'recruiters') {
        if (ui.viewTitle) ui.viewTitle.textContent = "Recruiter Verification Desk";
      }
    }

    ['home', 'talents', 'recruiters', 'rankings'].forEach(t => {
      const btn = document.getElementById(`btn-tab-${t}`);
      if (!btn) return;
      if (t === tabId) {
        btn.className = "w-full group flex items-center gap-3 px-3 py-2.5 rounded-xl border border-transparent bg-white/5 border-purple-500/30 text-white shadow-[0_0_20px_rgba(109,40,217,.12)] transition text-left";
      } else {
        btn.className = "w-full group flex items-center gap-3 px-3 py-2.5 rounded-xl border border-transparent text-gray-400 hover:text-white hover:bg-white/5 transition text-left";
      }
    });

    renderPipelineCards(cachedProfilesList);
  }

  function setupRealTimeStats() {
    const db = window.firebase.firestore();
    const ui = getElements();

    db.collection('profiles').onSnapshot(snap => {
      let talentCount = 0;
      let pendingCount = 0;
      let recruiterVerifiedCount = 0;
      let featuredCount = 0;
      const verifiedProfilesList = [];

      snap.forEach(doc => {
        const d = doc.data();
        d.id = doc.id;
        
        const roleStr = String(d.userRole || d.role || '').toUpperCase();
        const vStatusStr = String(d.verificationStatus || d.status || '');
        const tierStr = String(d.visibility_tier || d.visibilityTier || '');

        if (roleStr === 'TALENT') talentCount++;
        if (vStatusStr === 'pending_review') pendingCount++;
        if (roleStr === 'RECRUITER' && vStatusStr === 'verified') recruiterVerifiedCount++;
        if (tierStr === 'FEATURED') featuredCount++;

        if (roleStr === 'TALENT' && vStatusStr === 'verified') {
          verifiedProfilesList.push(d);
        }
      });

      globalVerifiedProfilesCache = verifiedProfilesList;

      if (ui.totalTalents) ui.totalTalents.textContent = String(talentCount);
      if (ui.pendingReviews) ui.pendingReviews.textContent = String(pendingCount);
      if (ui.verifiedRecruiters) ui.verifiedRecruiters.textContent = String(recruiterVerifiedCount);
      if (ui.featuredProfiles) ui.featuredProfiles.textContent = String(featuredCount);

      if (currentTab === 'rankings') recalculateRankingsOverview();
    }, err => console.error(err));
  }

  // FIXED FIREBASE WRITER: Uses explicit fallbacks to always guarantee numerical updates
  async function commitWeightsToFirebaseBackend() {
    const ui = getElements();
    
    const pW = parseFloat(ui.wPortfolio?.value || 30);
    const sW = parseFloat(ui.wSkills?.value || 25);
    const eW = parseFloat(ui.wExperience?.value || 25);
    const cW = parseFloat(ui.wCompleteness?.value || 20);
    const fT = parseFloat(ui.tFeatured?.value || 85);
    const nT = parseFloat(ui.tNormal?.value || 50);

    try {
      await DashboardModel.updateCalibrationWeightsInFirebase(pW, sW, eW, cW, fT, nT);
      console.log("💾 [ViewModel] Saved configurations to cloud weights table document.");
    } catch (err) {
      console.error("Cloud configuration update failed execution:", err);
    }
  }

  async function triggerGlobalRecalculation() {
    const ui = getElements();
    if (!confirm("Execute retroactive system-wide data recalculation? This will update scores across existing profiles based on the new version parameters.")) return;

    if (ui.btnRecalc) {
      ui.btnRecalc.disabled = true;
      ui.btnRecalc.textContent = "⏳ Processing Batch Recalculation Engine...";
    }

    try {
      const updatedCount = await DashboardModel.executeGlobalScoreRecalculation();
      alert(`🎉 System recalculation complete! Successfully updated ${updatedCount} profiles inside Firestore.`);
    } catch (err) {
      console.error(err);
      alert("Error executed during engine batch calculation.");
    } finally {
      if (ui.btnRecalc) {
        ui.btnRecalc.disabled = false;
        ui.btnRecalc.textContent = "⚡ Execute Global System Recalculation";
      }
    }
  }

  function recalculateRankingsOverview() {
    const ui = getElements();
    if (!ui.rankingsPreviewGrid) return;

    if (globalVerifiedProfilesCache.length === 0) {
      ui.rankingsPreviewGrid.innerHTML = '<p class="text-gray-500 text-xs col-span-full italic py-4 text-center">No verified talent records discovered in database collections.</p>';
      return;
    }

    const tempWeights = {
      portfolioWeight: parseInt(ui.wPortfolio?.value || 30, 10),
      skillsWeight: parseInt(ui.wSkills?.value || 25, 10),
      experienceWeight: parseInt(ui.wExperience?.value || 25, 10),
      completenessWeight: parseInt(ui.wCompleteness?.value || 20, 10)
    };

    const cutOffFeatured = parseFloat(ui.tFeatured?.value || 85);
    const cutOffNormal = parseFloat(ui.tNormal?.value || 50);

    const processedList = globalVerifiedProfilesCache.map(p => {
      const safeProfile = p || {};
      
      const rawPort = safeProfile.portfolioScore !== undefined ? safeProfile.portfolioScore : (safeProfile.portfolio_score !== undefined ? safeProfile.portfolio_score : (safeProfile.rankingScore !== undefined ? safeProfile.rankingScore : 50));
      const rawSkil = safeProfile.skillsScore !== undefined ? safeProfile.skillsScore : (safeProfile.skills_score !== undefined ? safeProfile.skills_score : 50);
      const rawExp = safeProfile.experienceScore !== undefined ? safeProfile.experienceScore : (safeProfile.experience_score !== undefined ? safeProfile.experience_score : 50);
      const rawComp = safeProfile.completenessScore !== undefined ? safeProfile.completenessScore : (safeProfile.completeness_score !== undefined ? safeProfile.completeness_score : 50);

      const portfolioScore = isNaN(parseFloat(rawPort)) ? 50 : parseFloat(rawPort);
      const skillsScore = isNaN(parseFloat(rawSkil)) ? 50 : parseFloat(rawSkil);
      const experienceScore = isNaN(parseFloat(rawExp)) ? 50 : parseFloat(rawExp);
      const completenessScore = isNaN(parseFloat(rawComp)) ? 50 : parseFloat(rawComp);

      const div = (portfolioScore * tempWeights.portfolioWeight) + (skillsScore * tempWeights.skillsWeight) + (experienceScore * tempWeights.experienceWeight) + (completenessScore * tempWeights.completenessWeight);
      const totalW = tempWeights.portfolioWeight + tempWeights.skillsWeight + tempWeights.experienceWeight + tempWeights.completenessWeight;
      const calculatedScore = totalW > 0 ? parseFloat((div / totalW).toFixed(2)) : 0;

      let visibilityTier = 'LOW_VISIBILITY';
      if (calculatedScore >= cutOffFeatured) visibilityTier = 'FEATURED';
      else if (calculatedScore >= cutOffNormal) visibilityTier = 'NORMAL';
      
      return { ...safeProfile, calculatedScore, visibilityTier };
    });

    processedList.sort((a, b) => b.calculatedScore - a.calculatedScore);

    ui.rankingsPreviewGrid.innerHTML = processedList.map((m, idx) => {
      let tierBadgeClass = "bg-purple-500/10 text-purple-400 border-purple-500/20";
      if (m.visibilityTier === 'FEATURED') tierBadgeClass = "bg-pink-500/10 text-pink-400 border-pink-500/20 animate-pulse";
      if (m.visibilityTier === 'LOW_VISIBILITY') tierBadgeClass = "bg-red-500/10 text-red-400 border-red-500/20";

      return `
      <div class="rounded-2xl border border-white/5 bg-black/40 p-4 flex flex-col justify-between transition hover:border-white/10">
        <div class="flex justify-between items-start gap-2">
          <div class="truncate">
            <div class="flex items-center gap-1.5">
              <span class="text-gray-500 font-mono text-[11px] font-bold">#${idx + 1}</span>
              <h4 class="text-sm font-bold text-white truncate">${m.fullName || m.name || 'Verified Talent'}</h4>
            </div>
            <p class="text-[11px] text-gray-400 mt-0.5 truncate">Category: ${m.spotlightCategory || m.spotlight_category || 'General'}</p>
            <p class="text-[9px] font-mono text-gray-500 mt-1">Schema Version Check: V${m.rankingVersion || 1}</p>
          </div>
          <div class="text-right shrink-0">
            <div class="text-sm font-black text-white font-mono">${m.calculatedScore}</div>
            <span class="text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase mt-1 inline-block tracking-wider ${tierBadgeClass}">${m.visibilityTier}</span>
          </div>
        </div>
      </div>
      `;
    }).join('');
  }

  function startRealTimeReviewsListener() {
    const ui = getElements();
    if (!ui.container) return;

    DashboardModel.listenToPendingProfiles((profiles) => {
      cachedProfilesList = profiles; 
      renderPipelineCards(profiles);
    }, (err) => {
      console.error('Real-time connection fault:', err);
    });
  }

  function renderPipelineCards(profiles) {
    const ui = getElements();
    if (!ui.container) return;

    const filtered = profiles.filter(p => {
      const roleStr = String(p.role || p.userRole || '').toUpperCase();
      if (currentTab === 'talents') return roleStr === 'TALENT';
      if (currentTab === 'recruiters') return roleStr === 'RECRUITER';
      return true; 
    });

    if (filtered.length === 0) {
      ui.container.innerHTML = `<p class="text-gray-400 col-span-full py-6 text-sm italic text-center">Clear workspace category. No documents waiting review in this view.</p>`;
      return;
    }

    ui.container.innerHTML = filtered.map(p => {
      const isRecruiter = String(p.role || p.userRole || '').toUpperCase() === 'RECRUITER';
      const m = p.mediaAssets || {};

      function parseAndRenderLinks(inputData, label) {
        if (!inputData) return '<span class="text-gray-600 text-xs italic">Not Provided</span>';
        let linkArray = [];
        if (Array.isArray(inputData)) { linkArray = inputData; } 
        else if (typeof inputData === 'string') {
          if (inputData.includes(',')) { linkArray = inputData.split(','); } 
          else if (inputData.includes(' ')) { linkArray = inputData.split(' '); } 
          else { linkArray = [inputData]; }
        }

        const filteredLinks = linkArray.map(item => String(item).trim()).filter(item => item.length > 0);
        if (filteredLinks.length === 0) return '<span class="text-gray-600 text-xs italic">Not Provided</span>';

        return filteredLinks.map((urlStr, index) => {
          let cleaned = urlStr.replace(/^([a-zA-Z0-9_-]+)\s*:\s*/i, '').trim();
          if (!cleaned) return '';
          if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) { cleaned = 'https://' + cleaned; }
          const displayLabel = filteredLinks.length > 1 ? `${label} #${index + 1}` : label;
          return `<a href="${cleaned}" target="_blank" class="text-xs text-cyan-400 hover:underline inline-flex items-center gap-1 font-semibold transition hover:text-cyan-300 block bg-black/40 px-3 py-1.5 rounded-xl border border-white/5 mb-1 w-full truncate text-left">🔗 ${displayLabel}</a>`;
        }).join('');
      }

      const portfolioField = p.portfolioLink || p.portfolio_link || p.portfolio || '';
      const socialField = p.socialMediaLinks || p.social_media_links || p.socialMediaLinksList || p.socialLinks || p.social_links || m.profileImageUrl || m.profile_image_url || '';
      const showreelField = m.showreelUrl || m.showreel_url || p.showreelUrl || p.showreel_url || '';

      const pastWorkLinkHtml = parseAndRenderLinks(portfolioField, 'Portfolio Website');
      const videoLinkHtml = parseAndRenderLinks(showreelField, 'Showreel Video File');
      const socialLinkHtml = parseAndRenderLinks(socialField, 'Social Media Links');

      const finalHeadshotUrl = m.headshotUrl || m.headshot_url || m.profileImageUrl || m.profile_image_url || p.profileImage || p.profile_image || '';
      const fallbackInitials = `https://ui-avatars.com/api/?name=${encodeURIComponent(p.fullName || 'User')}&background=c084fc&color=fff`;
      const finalNicUrl = p.nicImageUrl || p.nic_image_url || m.nicImageUrl || m.nic_image_url || '';

      if (isRecruiter) {
        return `
        <div class="rounded-3xl bg-[#121212] border border-white/10 p-6 flex flex-col justify-between transition duration-300 hover:border-amber-500/20">
          <div class="space-y-4">
            <div class="flex justify-between items-start">
              <div>
                <span class="text-[9px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">Recruiter Space</span>
                <h3 class="text-xl font-bold text-white mt-1">${p.companyName || p.company_name || p.fullName || 'Untitled Entity'}</h3>
                <p class="text-xs text-gray-400 mt-0.5">Recruiter Type: <span class="text-white font-medium">${p.industryType || p.industry_type || 'Casting Executive'}</span></p>
              </div>
              <span class="px-2 py-1 rounded bg-yellow-500/10 text-yellow-500 text-[10px] font-bold uppercase tracking-wider animate-pulse">Waiting Room</span>
            </div>
            <div class="bg-black/30 p-4 rounded-2xl border border-white/5 space-y-3">
              <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest border-b border-white/5 pb-1">Recruiter Verification Assets</p>
              <div class="space-y-3 text-xs text-gray-300">
                <div><span class="text-gray-500 block text-[9px] uppercase font-bold tracking-wider mb-0.5">Previous Production Work Links:</span> <div class="space-y-1">${pastWorkLinkHtml}</div></div>
                <div><span class="text-gray-500 block text-[9px] uppercase font-bold tracking-wider mb-0.5">YouTube / Vimeo Links:</span> <div class="space-y-1">${videoLinkHtml}</div></div>
                <div><span class="text-gray-500 block text-[9px] uppercase font-bold tracking-wider mb-0.5">Facebook / Instagram Links:</span> <div class="space-y-1">${socialLinkHtml}</div></div>
              </div>
              <div class="pt-2 border-t border-white/5">
                <p class="text-[9px] uppercase font-bold text-gray-500 mb-1">Optional NIC image</p>
                ${finalNicUrl && finalNicUrl.trim().startsWith('http')
                  ? `<a href="${finalNicUrl.trim()}" target="_blank" class="block group relative rounded-lg overflow-hidden border border-white/10 bg-black max-w-[120px]">
                       <img src="${finalNicUrl.trim()}" class="w-full h-14 object-cover opacity-60 group-hover:opacity-100 transition" onerror="this.src='${fallbackInitials}'" />
                     </a>`
                  : '<span class="text-xs text-gray-500 italic">Optional NIC not attached</span>'
                }
              </div>
            </div>
          </div>
          ${renderActionTray(p.id)}
        </div>
        `;
      }
      
      return `
      <div class="rounded-3xl bg-[#121212] border border-white/10 p-6 flex flex-col justify-between transition duration-300 hover:border-purple-500/20">
        <div class="space-y-4">
          <div class="flex justify-between items-start">
            <div class="flex gap-4 items-center">
              <div class="w-14 h-14 rounded-2xl bg-black border border-white/10 overflow-hidden shrink-0">
                <img src="${finalHeadshotUrl.startsWith('http') ? finalHeadshotUrl : fallbackInitials}" class="w-full h-full object-cover" onerror="this.src='${fallbackInitials}'" />
              </div>
              <div>
                <span class="text-[9px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">Talent Record</span>
                <h3 class="text-lg font-bold text-white mt-0.5">${p.fullName || p.name || 'Anonymous Performer'}</h3>
                <p class="text-xs text-gray-400">Category: <span class="text-cyan-400 font-semibold uppercase">${p.spotlightCategory || p.spotlight_category || 'General'}</span></p>
              </div>
            </div>
            <span class="px-2 py-1 rounded bg-yellow-500/10 text-yellow-500 text-[10px] font-bold uppercase tracking-wider">Waiting Room</span>
          </div>

          <div class="bg-black/30 p-4 rounded-2xl border border-white/5 grid grid-cols-2 gap-4 text-xs">
            <div class="space-y-1">
              <p class="text-gray-500 text-[9px] uppercase font-bold tracking-wider">profile quality</p>
              <p class="text-base font-extrabold text-white">${p.completenessScore || p.completeness_score || 0}% Yield</p>
            </div>
            <div class="w-full space-y-1">
              <p class="text-gray-500 text-[9px] uppercase font-bold tracking-wider">calculated score</p>
              <p class="text-base font-extrabold text-purple-400">${p.rankingScore || p.ranking_score || 0} Points</p>
            </div>
            <div class="col-span-full space-y-2 border-t border-white/5 pt-3">
              <p class="text-gray-500 text-[9px] uppercase font-bold tracking-wider mb-1">media links Matrix</p>
              <div class="flex flex-col gap-2 mt-1">
                <div><span class="text-gray-500 text-[10px] font-medium block">Portfolio Website:</span> ${pastWorkLinkHtml}</div>
                <div><span class="text-gray-500 text-[10px] font-medium block">Showreel Video File:</span> ${videoLinkHtml}</div>
                <div><span class="text-gray-500 text-[10px] font-medium block">Social Media Links:</span> ${socialLinkHtml}</div>
              </div>
            </div>
          </div>
        </div>
        ${renderActionTray(p.id, true)}
      </div>
      `;
    }).join('');
  }

  function renderActionTray(id, isTalent = false) {
    return `
    <div class="mt-6 pt-4 border-t border-white/5 space-y-2">
      <div class="flex gap-2">
        <button onclick="window.DashboardViewModel.handleApprove('${id}')" class="flex-1 bg-white text-black py-2 rounded-xl text-xs font-extrabold hover:bg-gray-200 transition">✓ Approve</button>
        <button onclick="window.DashboardViewModel.handleReject('${id}')" class="flex-1 bg-red-500/10 text-red-500 py-2 rounded-xl text-xs font-extrabold hover:bg-red-500/20 transition">✕ Reject</button>
      </div>
      <div class="flex gap-2">
        <button onclick="window.DashboardViewModel.handleRequestChanges('${id}')" class="flex-1 bg-white/5 text-gray-300 border border-white/10 py-2 rounded-xl text-xs font-bold hover:bg-white/10 transition">⟳ Request Changes</button>
        ${isTalent ? `<button onclick="window.DashboardViewModel.openTalentDetailsModal('${id}')" class="flex-1 bg-purple-500/10 text-purple-400 border border-purple-500/20 py-2 rounded-xl text-xs font-bold hover:bg-purple-500/20 transition">ℹ Talent Details Page</button>` : ''}
      </div>
    </div>
    `;
  }

  async function handleApprove(id) {
    if (confirm("Confirm verification approval allocation for this document registration?")) {
      await DashboardModel.approveProfile(id);
    }
  }

  async function handleReject(id) {
    if (confirm("Are you certain you want to reject this profile registration?")) {
      await DashboardModel.rejectProfile(id);
    }
  }

  async function handleRequestChanges(id) {
    const notes = prompt("Enter specific verification adjustment feedback text logs:");
    if (notes === null) return;
    try {
      const db = window.firebase.firestore();
      await db.collection('profiles').doc(id).update({
        verificationStatus: 'changes_requested',
        status: 'draft',
        moderationNotes: notes || "Failed operational verification parameters."
      });
      alert("Dispatched modification parameters.");
    } catch (e) { console.error(e); }
  }

  async function openTalentDetailsModal(id) {
    try {
      const db = window.firebase.firestore();
      const snap = await db.collection('profiles').doc(id).get();
      if (!snap.exists) return;
      const p = snap.data();

      let dialog = document.getElementById('admin-talent-modal');
      if (!dialog) {
        dialog = document.createElement('div');
        dialog.id = 'admin-talent-modal';
        dialog.className = "fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur flex items-center justify-center p-4 transition duration-200";
        document.body.appendChild(dialog);
      }

      dialog.innerHTML = `
      <div class="bg-[#121212] border border-white/15 w-full max-w-2xl rounded-3xl p-6 relative shadow-2xl space-y-4 text-left">
        <button onclick="document.getElementById('admin-talent-modal').remove()" class="absolute top-4 right-4 text-gray-500 hover:text-white text-xl transition">✕</button>
        <div><h2 class="text-xl font-bold text-white">Talent Comprehensive Details Page</h2><p class="text-xs text-gray-500 font-mono">Profile ID: ${id}</p></div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs border-t border-white/5 pt-4">
          <div>
            <p class="text-gray-500 font-semibold uppercase">profile information</p>
            <p class="text-white text-sm mt-1 font-bold">${p.fullName || p.name || 'Anonymous User'}</p>
            <p class="text-gray-400 mt-1">${p.email || 'N/A'} | ${p.phoneNumber || 'N/A'}</p>
          </div>
          <div>
            <p class="text-gray-500 font-semibold uppercase">verification status</p>
            <span class="inline-block mt-2 px-2.5 py-1 rounded bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 font-bold uppercase text-[10px] tracking-wider">${p.verificationStatus || p.status || 'pending_review'}</span>
          </div>
          <div class="col-span-full">
            <p class="text-gray-500 font-semibold uppercase">skills matrix</p>
            <p class="text-gray-200 mt-1 font-mono text-xs bg-black/30 p-2 rounded-lg border border-white/5">${p.skills && Array.isArray(p.skills) ? p.skills.join(', ') : (p.languages || 'None Listed')}</p>
          </div>
          <div class="col-span-full">
            <p class="text-gray-500 font-semibold uppercase">experience</p>
            <p class="text-gray-300 mt-1 bg-black/20 p-3 rounded-xl border border-white/5">${p.experience || '0'} Years Active</p>
          </div>
        </div>
      </div>
      `;
    } catch (err) { console.error(err); }
  }

  async function recommendationSimulationFilterAndSort(targetCategory, targetSkill, requestedDate) {
    const db = window.firebase.firestore();
    const snap = await db.collection('profiles').where('verificationStatus', '==', 'verified').get();
    const validRecommendations = [];

    for (const doc of snap.docs) {
      const p = doc.data();
      p.id = doc.id;

      const hasCategory = String(p.spotlight_category || p.spotlightCategory || '').toLowerCase() === targetCategory.toLowerCase();
      let hasSkill = false;
      if (p.skills && Array.isArray(p.skills)) {
        hasSkill = p.skills.some(s => s.toLowerCase().includes(targetSkill.toLowerCase()));
      } else if (typeof p.languages === 'string') {
        hasSkill = p.languages.toLowerCase().includes(targetSkill.toLowerCase());
      }

      if (hasCategory && hasSkill) {
        if (requestedDate) {
          const unavailRef = db.collection('profiles').doc(p.id).collection('unavailabilities').doc(requestedDate);
          const unavailSnap = await unavailRef.get();
          if (unavailSnap.exists && unavailSnap.data().isBlocked === true) continue;
        }
        validRecommendations.push(p);
      }
    }
    validRecommendations.sort((a, b) => (b.calculated_score || 0) - (a.calculated_score || 0));
    return validRecommendations;
  }

  async function triggerRecommendationQuery() {
    const ui = getElements();
    if (!ui.simGrid || !ui.simWrapper) return;
    ui.simWrapper.classList.remove('hidden');
    ui.simGrid.innerHTML = '<p class="text-cyan-400 col-span-full text-xs">Processing algorithms lookup...</p>';
    try {
      const matchedProfiles = await recommendationSimulationFilterAndSort(ui.simCategory?.value, ui.simSkill?.value.trim(), ui.simDate?.value);
      if (matchedProfiles.length === 0) {
        ui.simGrid.innerHTML = '<p class="text-gray-500 col-span-full py-4 text-xs">No matching verified discovery profiles available.</p>';
        return;
      }
      ui.simGrid.innerHTML = matchedProfiles.map(m => `
        <div class="rounded-2xl border border-white/5 bg-black/40 p-4 flex flex-col justify-between">
          <div class="flex justify-between items-start">
            <div>
              <h4 class="text-sm font-bold text-white">${m.name || m.fullName || 'Verified'}</h4>
              <p class="text-[11px] text-gray-400 mt-0.5">Score index: ${m.calculated_score || 0}</p>
            </div>
            <span class="text-[9px] px-2 py-0.5 font-bold rounded bg-purple-500/10 text-purple-400 uppercase">${m.visibility_tier || 'NORMAL'}</span>
          </div>
        </div>
      `).join('');
    } catch (err) { ui.simGrid.innerHTML = '<p class="text-red-500 col-span-full text-xs">Processing fault encountered.</p>'; }
  }

  let initRetries = 0;
  function init() {
    if (!window.firebase || !window.firebase.firestore) {
      if (initRetries >= 50) return;
      initRetries++;
      setTimeout(init, 100);
      return;
    }
    console.log('✅ [ViewModel] Attaching real-time navigation components listeners.');
    
    DashboardModel.syncCalibrationWeights((w) => {
      const ui = getElements();
      if (ui.wPortfolio && ui.tFeatured && ui.tNormal) {
        ui.wPortfolio.value = w.portfolioWeight;
        ui.wSkills.value = w.skillsWeight;
        ui.wExperience.value = w.experienceWeight;
        ui.wCompleteness.value = w.completenessWeight;
        
        ui.tFeatured.value = w.featuredThreshold;
        ui.tNormal.value = w.normalThreshold;
        
        // DYNAMIC LABELS SAFELY BOUND WITH DEFENSIVE NULL CHECK OPERATORS
        if (ui.lblPortfolio) ui.lblPortfolio.textContent = w.portfolioWeight;
        if (ui.lblSkills) ui.lblSkills.textContent = w.skillsWeight;
        if (ui.lblExperience) ui.lblExperience.textContent = w.experienceWeight;
        if (ui.lblCompleteness) ui.lblCompleteness.textContent = w.completenessWeight;
        
        ui.wPortfolio.oninput = () => {
          if (ui.lblPortfolio) ui.lblPortfolio.textContent = ui.wPortfolio.value;
          recalculateRankingsOverview();
        };
        ui.wSkills.oninput = () => {
          if (ui.lblSkills) ui.lblSkills.textContent = ui.wSkills.value;
          recalculateRankingsOverview();
        };
        ui.wExperience.oninput = () => {
          if (ui.lblExperience) ui.lblExperience.textContent = ui.wExperience.value;
          recalculateRankingsOverview();
        };
        ui.wCompleteness.oninput = () => {
          if (ui.lblCompleteness) ui.lblCompleteness.textContent = ui.wCompleteness.value;
          recalculateRankingsOverview();
        };
        ui.tFeatured.oninput = () => recalculateRankingsOverview();
        ui.tNormal.oninput = () => recalculateRankingsOverview();

        ui.wPortfolio.onchange = () => commitWeightsToFirebaseBackend();
        ui.wSkills.onchange = () => commitWeightsToFirebaseBackend();
        ui.wExperience.onchange = () => commitWeightsToFirebaseBackend();
        ui.wCompleteness.onchange = () => commitWeightsToFirebaseBackend();
        ui.tFeatured.onchange = () => commitWeightsToFirebaseBackend();
        ui.tNormal.onchange = () => commitWeightsToFirebaseBackend();
      }
    });

    setupRealTimeStats();
    startRealTimeReviewsListener();
  }

  return { init, switchTab, handleApprove, handleReject, handleRequestChanges, openTalentDetailsModal, triggerRecommendationQuery, recalculateRankingsOverview, triggerGlobalRecalculation };
})();

window.DashboardViewModel = DashboardViewModel;
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => window.DashboardViewModel.init());
} else {
  window.DashboardViewModel.init();
}