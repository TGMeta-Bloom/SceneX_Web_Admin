// dashboard-model.js
const DashboardModel = (() => {
  let dbWeightsCache = {
    portfolioWeight: 30,      
    skillsWeight: 25,         
    experienceWeight: 25,     
    completenessWeight: 20,   
    featuredThreshold: 85,    
    normalThreshold: 50,
    rankingVersion: 1         
  };

  function getDb() {
    if (!window.firebase || !window.firebase.firestore) {
      throw new Error('Firebase core instances missing from global scope.');
    }
    return window.firebase.firestore();
  }

  function enforceSafeWeightRange(val, minRange, maxRange, fallbackVal) {
    const parsed = parseInt(val, 10);
    if (isNaN(parsed)) return fallbackVal;
    if (parsed < minRange) return minRange;
    if (parsed > maxRange) return maxRange;
    return parsed;
  }

  function calculateScore(p) {
    if (!p) return 0;
    const rawPortfolio = p.portfolioScore !== undefined ? p.portfolioScore : (p.portfolio_score !== undefined ? p.portfolio_score : (p.rankingScore !== undefined ? p.rankingScore : 50));
    const rawSkills = p.skillsScore !== undefined ? p.skillsScore : (p.skills_score !== undefined ? p.skills_score : 50);
    const rawExperience = p.experienceScore !== undefined ? p.experienceScore : (p.experience_score !== undefined ? p.experience_score : 50);
    const rawCompleteness = p.completenessScore !== undefined ? p.completenessScore : (p.completeness_score !== undefined ? p.completeness_score : 50);

    const portfolioScore = isNaN(parseFloat(rawPortfolio)) ? 50 : parseFloat(rawPortfolio);
    const skillsScore = isNaN(parseFloat(rawSkills)) ? 50 : parseFloat(rawSkills);
    const experienceScore = isNaN(parseFloat(rawExperience)) ? 50 : parseFloat(rawExperience);
    const completenessScore = isNaN(parseFloat(rawCompleteness)) ? 50 : parseFloat(rawCompleteness);

    const wPortfolio = isNaN(parseFloat(dbWeightsCache.portfolioWeight)) ? 30 : parseFloat(dbWeightsCache.portfolioWeight);
    const wSkills = isNaN(parseFloat(dbWeightsCache.skillsWeight)) ? 25 : parseFloat(dbWeightsCache.skillsWeight);
    const wExperience = isNaN(parseFloat(dbWeightsCache.experienceWeight)) ? 25 : parseFloat(dbWeightsCache.experienceWeight);
    const wCompleteness = isNaN(parseFloat(dbWeightsCache.completenessWeight)) ? 20 : parseFloat(dbWeightsCache.completenessWeight);

    const dividend = (portfolioScore * wPortfolio) + (skillsScore * wSkills) + (experienceScore * wExperience) + (completenessScore * wCompleteness);
    const divisor = wPortfolio + wSkills + wExperience + wCompleteness;

    return divisor > 0 ? parseFloat((dividend / divisor).toFixed(2)) : 0;
  }

  function assignTier(score, profileData, mediaAssets) {
    const cutOffFeatured = parseFloat(dbWeightsCache.featuredThreshold !== undefined && !isNaN(dbWeightsCache.featuredThreshold) ? dbWeightsCache.featuredThreshold : 85);
    const cutOffNormal = parseFloat(dbWeightsCache.normalThreshold !== undefined && !isNaN(dbWeightsCache.normalThreshold) ? dbWeightsCache.normalThreshold : 50);
    
    const safeData = profileData || {};
    const vStatusStr = String(safeData.verificationStatus || safeData.status || '');
    const m = mediaAssets || safeData.mediaAssets || {};
    const hasHeadshot = String(m.headshotUrl || m.headshot_url || m.profileImageUrl || m.profile_image_url || safeData.profileImage || safeData.profile_image || '').trim().startsWith('http');

    if (score >= cutOffFeatured && vStatusStr === 'verified' && hasHeadshot) {
      return 'FEATURED';
    }
    if (score >= cutOffNormal) {
      return 'NORMAL';
    }
    return 'LOW_VISIBILITY';
  }

  function syncCalibrationWeights(onSyncCallback) {
    const db = getDb();
    db.collection('ranking_calibration').doc('weights').onSnapshot((doc) => {
      if (doc.exists) {
        const d = doc.data();
        dbWeightsCache = {
          portfolioWeight: enforceSafeWeightRange(d.portfolioWeight, 20, 40, 30),
          skillsWeight: enforceSafeWeightRange(d.skillsWeight, 10, 30, 25),
          experienceWeight: enforceSafeWeightRange(d.experienceWeight, 10, 30, 25),
          completenessWeight: enforceSafeWeightRange(d.completenessWeight, 10, 30, 20),
          featuredThreshold: parseFloat(d.featuredThreshold !== undefined && !isNaN(parseFloat(d.featuredThreshold)) ? parseFloat(d.featuredThreshold) : 85),
          normalThreshold: parseFloat(d.normalThreshold !== undefined && !isNaN(parseFloat(d.normalThreshold)) ? parseFloat(d.normalThreshold) : 50),
          rankingVersion: parseInt(d.rankingVersion || 1, 10)
        };
        console.log("📊 [Model] Real-time rules calibration synchronized seamlessly:", dbWeightsCache);
        if (onSyncCallback) onSyncCallback(dbWeightsCache);
      }
    }, err => console.error("Weights tracking pipeline fault:", err));
  }

  async function updateCalibrationWeightsInFirebase(wPortfolio, wSkills, wExperience, wCompleteness, fThresh, nThresh) {
    const db = getDb();
    const pW = enforceSafeWeightRange(wPortfolio, 20, 40, 30);
    const sW = enforceSafeWeightRange(wSkills, 10, 30, 25);
    const eW = enforceSafeWeightRange(wExperience, 10, 30, 25);
    const cW = enforceSafeWeightRange(wCompleteness, 10, 30, 20);
    const fT = parseFloat(fThresh || 85);
    const nT = parseFloat(nThresh || 50);

    const docRef = db.collection('ranking_calibration').doc('weights');
    const currentSnap = await docRef.get();
    const currentVersion = currentSnap.exists ? parseInt(currentSnap.data().rankingVersion || 1, 10) : 1;
    const nextVersion = currentVersion + 1;

    await docRef.set({
      portfolioWeight: pW,
      skillsWeight: sW,
      experienceWeight: eW,
      completenessWeight: cW,
      featuredThreshold: fT,
      normalThreshold: nT,
      rankingVersion: nextVersion,
      lastCalibratedAt: Date.now()
    }, { merge: true });
    
    dbWeightsCache.portfolioWeight = pW;
    dbWeightsCache.skillsWeight = sW;
    dbWeightsCache.experienceWeight = eW;
    dbWeightsCache.completenessWeight = cW;
    dbWeightsCache.featuredThreshold = fT;
    dbWeightsCache.normalThreshold = nT;
    dbWeightsCache.rankingVersion = nextVersion;
  }

  async function executeGlobalScoreRecalculation() {
    const db = getDb();
    const snap = await db.collection('profiles').get();
    const batch = db.batch();
    let counter = 0;

    const targetVersion = parseInt(dbWeightsCache.rankingVersion || 1, 10);

    for (const doc of snap.docs) {
      const pData = doc.data();
      const id = doc.id;
      const roleStr = String(pData.userRole || pData.role || '').toUpperCase();

      if (roleStr === 'TALENT') {
        let media = null;
        try {
          const mediaSnap = await db.collection('media_assets').doc(id).get();
          if (mediaSnap.exists) media = mediaSnap.data();
        } catch (e) {}

        const newScore = calculateScore(pData);
        const newTier = assignTier(newScore, pData, media);

        const docRef = db.collection('profiles').doc(id);
        batch.update(docRef, {
          calculated_score: parseFloat(newScore),
          rankingScore: Math.round(newScore),
          visibility_tier: newTier,
          rankingVersion: targetVersion, 
          lastEngineRecalculationTimestamp: Date.now()
        });
        counter++;
      }
    }

    if (counter > 0) {
      await batch.commit();
    }
    return counter;
  }

  // FIXED MEDIA ASSETS LOOKUP: Resolves sub-collection paths to ensure images are available
  function listenToPendingProfiles(onUpdateCallback, onErrorCallback) {
    try {
      const db = getDb();
      return db.collection('profiles').onSnapshot(async (snap) => {
        const results = [];
        
        snap.forEach((doc) => {
          const profileData = doc.data();
          const id = doc.id;
          const isPending = profileData.verificationStatus === 'pending_review' || profileData.status === 'pending_review';
          
          if (isPending) {
            results.push({ id, ...profileData });
          }
        });
        
        // Asynchronously trace media assets collection details sequentially to prevent layout gaps
        const finalizedResults = [];
        for (const item of results) {
          let specs = null;
          let media = null;
          
          try {
            const specsSnap = await db.collection('talent_specs').doc(item.id).get();
            if (specsSnap.exists) specs = specsSnap.data();
          } catch (e) {}
          
          try {
            const mediaSnap = await db.collection('media_assets').doc(item.id).get();
            if (mediaSnap.exists) media = mediaSnap.data();
          } catch (e) {}
          
          finalizedResults.push({
            ...item,
            talentSpecs: specs,
            mediaAssets: media // Binds sub-collection references cleanly
          });
        }
        
        onUpdateCallback(finalizedResults);
      }, (err) => { if (onErrorCallback) onErrorCallback(err); });
    } catch (err) { if (onErrorCallback) onErrorCallback(err); }
  }

  async function approveProfile(profileId) {
    try {
      const db = getDb();
      const docRef = db.collection('profiles').doc(profileId);
      const snap = await docRef.get();
      if (!snap.exists) return { ok: false, error: "Document missing" };
      
      const profileData = snap.data();
      let media = null;
      try {
        const mediaSnap = await db.collection('media_assets').doc(profileId).get();
        if (mediaSnap.exists) media = mediaSnap.data();
      } catch (e) {}

      const finalScore = calculateScore(profileData);
      const mockApprovedProfile = { ...profileData, verificationStatus: 'verified' };
      const tier = assignTier(finalScore, mockApprovedProfile, media);

      await docRef.update({
        verificationStatus: 'verified',
        status: 'verified',
        moderatedAt: Date.now(),
        moderationDecision: 'approve',
        calculated_score: parseFloat(finalScore),
        visibility_tier: tier,
        rankingScore: Math.round(finalScore),
        rankingVersion: parseInt(dbWeightsCache.rankingVersion || 1, 10)
      });

      return { ok: true, score: finalScore, tier };
    } catch (error) {
      console.error("❌ Error inside approveProfile:", error);
      throw error;
    }
  }

  async function rejectProfile(profileId) {
    const db = getDb();
    await db.collection('profiles').doc(profileId).update({
      verificationStatus: 'rejected',
      status: 'rejected',
      moderatedAt: Date.now(),
      moderationDecision: 'reject'
    });
    return { ok: true };
  }

  return { 
    listenToPendingProfiles, 
    approveProfile, 
    rejectProfile, 
    calculateScore, 
    assignTier,
    syncCalibrationWeights,
    updateCalibrationWeightsInFirebase,
    executeGlobalScoreRecalculation
  };
})();