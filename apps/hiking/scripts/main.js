(function () {
  const storageKeys = {
    records: 'hikingRecords',
    routes: 'hikingRoutes',
    profile: 'hikingProfile'
  };

  const state = {
    records: [],
    routes: [],
    currentEditId: null,
    currentPhotos: [],
    profile: {
      name: '',
      email: '',
      bio: '',
      avatarUrl: ''
    },
    carouselIndex: 0,
    carouselTimer: null,
    statsScope: 'year'
  };

  const supportsCryptoUUID = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function';

  function createId() {
    if (supportsCryptoUUID) {
      return crypto.randomUUID();
    }
    const randomPart = Math.random().toString(36).slice(2, 10);
    return `id-${Date.now().toString(36)}-${randomPart}`;
  }

  const DEFAULT_AVATAR = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop stop-color="%23b7c9ff" offset="0%"/><stop stop-color="%23eef2ff" offset="100%"/></linearGradient></defs><rect width="160" height="160" rx="80" fill="url(%23g)"/><circle cx="80" cy="64" r="34" fill="%23ffffff" opacity="0.82"/><path d="M40 134c8-24 40-28 40-28s32 4 40 28" fill="none" stroke="%23ffffff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/></svg>';
  const DEFAULT_RECORD_IMAGE = './assets/images/climb.jpg';

  const dom = {
    views: document.querySelectorAll('.view'),
    navButtons: document.querySelectorAll('.nav-btn'),
    homeStats: document.getElementById('homeStats'),
    carousel: document.getElementById('homeCarousel'),
    carouselTrack: document.getElementById('carouselTrack'),
    carouselDots: document.getElementById('carouselDots'),
    carouselPrev: document.getElementById('carouselPrev'),
    carouselNext: document.getElementById('carouselNext'),
    recordList: document.getElementById('recordList'),
    completedList: document.getElementById('completedList'),
    challengeList: document.getElementById('challengeList'),
    challengeSearch: document.getElementById('challengeSearch'),
    challengeFilter: document.getElementById('challengeFilter'),
    profileForm: document.getElementById('profileForm'),
    profileName: document.getElementById('profileName'),
    profileEmail: document.getElementById('profileEmail'),
    profileBio: document.getElementById('profileBio'),
    profileAvatar: document.getElementById('profileAvatar'),
    profileDisplayName: document.getElementById('profileDisplayName'),
    profileAvatarUrl: document.getElementById('profileAvatarUrl'),
    fabAddRecord: document.getElementById('fabAddRecord'),
    openRecordDialog: document.getElementById('openRecordDialog'),
    openRouteDialog: document.getElementById('openRouteDialog'),
    recordDialog: document.getElementById('recordDialog'),
    routeDialog: document.getElementById('routeDialog'),
    recordForm: document.getElementById('recordForm'),
    recordDialogTitle: document.getElementById('recordDialogTitle'),
    recordId: document.getElementById('recordId'),
    routeName: document.getElementById('routeName'),
    routeSuggestions: document.getElementById('routeSuggestions'),
    routeCategory: document.getElementById('routeCategory'),
    hikeDate: document.getElementById('hikeDate'),
    distanceKm: document.getElementById('distanceKm'),
    elevationGain: document.getElementById('elevationGain'),
    durationHours: document.getElementById('durationHours'),
    notes: document.getElementById('notes'),
    photos: document.getElementById('photos'),
    existingPhotos: document.getElementById('existingPhotos'),
    cancelEdit: document.getElementById('cancelEdit'),
    deleteRecord: document.getElementById('deleteRecord'),
    addRouteForm: document.getElementById('addRouteForm'),
    newRouteName: document.getElementById('newRouteName'),
    newRouteCategory: document.getElementById('newRouteCategory'),
    newRouteDistance: document.getElementById('newRouteDistance'),
    newRouteElevation: document.getElementById('newRouteElevation'),
    newRouteNotes: document.getElementById('newRouteNotes'),
    searchKeyword: document.getElementById('searchKeyword'),
    filterCategory: document.getElementById('filterCategory'),
    filterStart: document.getElementById('filterStart'),
    filterEnd: document.getElementById('filterEnd'),
    clearFilters: document.getElementById('clearFilters'),
    previewDialog: document.getElementById('photoPreviewDialog'),
    previewImage: document.getElementById('previewImage'),
    toast: document.getElementById('toast'),
    scopeButtons: document.querySelectorAll('[data-stats-scope]')
  };

  const defaultRoutes = [
    { id: createId(), name: '雪山主峰', category: '百岳', status: 'completed', lastHikedDate: '2023-10-21', notes: '黑森林的晨曦最難忘', isChallenge: false, distanceKm: 10.9, elevationGain: 1200, durationHours: 18 },
    { id: createId(), name: '合歡北峰', category: '百岳', status: 'pending', lastHikedDate: null, notes: '想體驗日出', isChallenge: true, distanceKm: 5.2, elevationGain: 620 },
    { id: createId(), name: '司馬庫斯巨木步道', category: '古道', status: 'completed', lastHikedDate: '2024-02-11', notes: '巨木群值得再訪', isChallenge: false, distanceKm: 6.4, elevationGain: 380, durationHours: 8.5 },
    { id: createId(), name: '嘉明湖', category: '高山湖', status: 'pending', lastHikedDate: null, notes: '藍寶石要親眼目睹', isChallenge: true, distanceKm: 13.2, elevationGain: 950 },
    { id: createId(), name: '加里山', category: '小百岳', status: 'pending', lastHikedDate: null, notes: '', isChallenge: false, distanceKm: 7.6, elevationGain: 820 }
  ];

  const defaultRecords = [
    {
      id: createId(),
      routeName: '雪山主峰',
      category: '百岳',
      date: '2023-10-21',
      notes: '凌晨攻頂遇到壯麗雲海，風勢強勁需注意保暖。',
      distanceKm: 10.9,
      elevationGain: 1200,
      durationHours: 18,
      photos: [],
      createdAt: new Date('2023-10-21T20:10:00').toISOString(),
      updatedAt: new Date('2023-10-21T20:10:00').toISOString()
    },
    {
      id: createId(),
      routeName: '司馬庫斯巨木步道',
      category: '古道',
      date: '2024-02-11',
      notes: '巨木區非常震撼，帶長輩同行步調放慢但平穩。',
      distanceKm: 6.4,
      elevationGain: 380,
      durationHours: 8.5,
      photos: [],
      createdAt: new Date('2024-02-11T18:30:00').toISOString(),
      updatedAt: new Date('2024-02-11T18:30:00').toISOString()
    }
  ];

  function init() {
    loadState();
    bindEvents();
    updateScopeButtons();
    populateProfileForm();
    renderProfileHeader();
    renderAll();
    switchView('home');
  }

  function loadState() {
    const storedRecords = localStorage.getItem(storageKeys.records);
    const storedRoutes = localStorage.getItem(storageKeys.routes);
    const storedProfile = localStorage.getItem(storageKeys.profile);

    const parsedRecords = storedRecords ? safeParse(storedRecords, defaultRecords) : defaultRecords;
    const parsedRoutes = storedRoutes ? safeParse(storedRoutes, defaultRoutes) : defaultRoutes;

    state.records = (Array.isArray(parsedRecords) ? parsedRecords : defaultRecords).map((record) => ({
      ...record,
      notes: record.notes ?? '',
      distanceKm: record.distanceKm != null ? Number(record.distanceKm) : null,
      elevationGain: record.elevationGain != null ? Number(record.elevationGain) : null,
      durationHours: record.durationHours != null ? Number(record.durationHours) : null
    }));

    state.routes = (Array.isArray(parsedRoutes) ? parsedRoutes : defaultRoutes).map((route) => ({
      ...route,
      notes: route.notes ?? '',
      isChallenge: Boolean(route.isChallenge),
      distanceKm: route.distanceKm != null ? Number(route.distanceKm) : null,
      elevationGain: route.elevationGain != null ? Number(route.elevationGain) : null,
      durationHours: route.durationHours != null ? Number(route.durationHours) : null
    }));

    const defaultProfile = { name: '', email: '', bio: '', avatarUrl: DEFAULT_AVATAR };
    const parsedProfile = storedProfile ? safeParse(storedProfile, defaultProfile) : defaultProfile;
    state.profile = { ...defaultProfile, ...parsedProfile };
    if (!state.profile.avatarUrl) {
      state.profile.avatarUrl = DEFAULT_AVATAR;
    }
  }

  function safeParse(value, fallback) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
      return fallback;
    } catch (error) {
      console.warn('無法解析資料，改用預設值', error);
      return fallback;
    }
  }

  function bindEvents() {
    dom.navButtons.forEach((button) => {
      button.addEventListener('click', () => switchView(button.dataset.viewTarget));
    });

    dom.openRecordDialog.addEventListener('click', () => enterNewRecordMode());
    dom.fabAddRecord?.addEventListener('click', () => enterNewRecordMode());
    dom.openRouteDialog.addEventListener('click', () => openDialog(dom.routeDialog));

    dom.scopeButtons?.forEach((button) => {
      button.addEventListener('click', () => setStatsScope(button.dataset.statsScope || 'year'));
    });

    document.querySelectorAll('.close-dialog').forEach((button) => {
      button.addEventListener('click', (event) => {
        const dialogId = event.currentTarget.dataset.closeDialog;
        if (!dialogId) return;
        const targetDialog = document.getElementById(dialogId);
        closeDialog(targetDialog);
      });
    });

    dom.recordForm.addEventListener('submit', handleSubmitRecord);
    dom.recordForm.addEventListener('reset', handleResetForm);
    dom.cancelEdit.addEventListener('click', () => {
      exitEditMode();
      closeDialog(dom.recordDialog);
    });
    dom.deleteRecord?.addEventListener('click', handleDeleteFromDialog);

    dom.recordList.addEventListener('click', handleRecordListClick);

    dom.searchKeyword?.addEventListener('input', renderRecordList);
    dom.filterCategory?.addEventListener('change', renderRecordList);
    dom.filterStart?.addEventListener('change', renderRecordList);
    dom.filterEnd?.addEventListener('change', renderRecordList);
    dom.clearFilters?.addEventListener('click', clearFilters);

    dom.addRouteForm.addEventListener('submit', handleAddRoute);
    dom.addRouteForm.addEventListener('reset', () => {
      dom.newRouteName.focus();
    });

    dom.challengeList.addEventListener('click', handleChallengeActions);
    dom.challengeSearch.addEventListener('input', renderChallengeList);
    dom.challengeFilter.addEventListener('change', renderChallengeList);

    dom.profileForm.addEventListener('submit', handleProfileSubmit);
    dom.profileForm.addEventListener('reset', (event) => {
      event.preventDefault();
      populateProfileForm();
    });

    dom.carouselPrev.addEventListener('click', () => moveCarousel(-1));
    dom.carouselNext.addEventListener('click', () => moveCarousel(1));

    dom.previewDialog.addEventListener('click', (event) => {
      if (event.target.dataset.closeDialog === 'photoPreviewDialog') {
        closeDialog(dom.previewDialog);
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && dom.previewDialog.open) {
        closeDialog(dom.previewDialog);
      }
    });
  }

  function switchView(targetView) {
    dom.views.forEach((view) => {
      view.classList.toggle('active', view.dataset.view === targetView);
      view.setAttribute('aria-hidden', view.dataset.view === targetView ? 'false' : 'true');
    });

    dom.navButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.viewTarget === targetView);
    });

    if (targetView === 'home') {
      startCarouselAuto();
    } else {
      stopCarouselAuto();
    }
  }

  function enterNewRecordMode(preset = {}) {
    state.currentEditId = null;
    state.currentPhotos = [];
    dom.recordForm.reset();
    dom.recordDialogTitle.textContent = '新增健行紀錄';
    dom.cancelEdit.classList.add('hidden');
    dom.deleteRecord?.classList.add('hidden');
    dom.existingPhotos.classList.add('hidden');

    if (preset.routeName) {
      dom.routeName.value = preset.routeName;
    }
    if (preset.category) {
      dom.routeCategory.value = preset.category;
    }
    dom.distanceKm.value = preset.distanceKm != null ? preset.distanceKm : '';
    dom.elevationGain.value = preset.elevationGain != null ? preset.elevationGain : '';
    dom.durationHours.value = preset.durationHours != null ? preset.durationHours : '';

    openDialog(dom.recordDialog);
  }

  function handleSubmitRecord(event) {
    event.preventDefault();
    const formData = new FormData(dom.recordForm);
    const distanceValue = parseFloat(formData.get('distanceKm'));
    const elevationValue = parseFloat(formData.get('elevationGain'));
    const durationValue = parseFloat(formData.get('durationHours'));

    const record = {
      id: state.currentEditId ?? createId(),
      routeName: formData.get('routeName').trim(),
      category: formData.get('routeCategory'),
      date: formData.get('hikeDate'),
      notes: formData.get('notes').trim(),
      distanceKm: Number.isFinite(distanceValue) ? distanceValue : null,
      elevationGain: Number.isFinite(elevationValue) ? elevationValue : null,
      durationHours: Number.isFinite(durationValue) ? durationValue : null,
      photos: [...state.currentPhotos],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (!record.routeName || !record.category || !record.date) {
      showToast('請完整填寫路線資訊', true);
      return;
    }

    if (state.currentEditId) {
      const original = state.records.find((item) => item.id === state.currentEditId);
      if (!original) {
        showToast('找不到原始紀錄，請重新新增。', true);
        exitEditMode();
        closeDialog(dom.recordDialog);
        return;
      }
      record.createdAt = original.createdAt;
      appendNewPhotos(record).then(() => {
        state.records = state.records.map((item) => (item.id === record.id ? record : item));
        finalizeRecordSave(record);
        showToast('紀錄已更新');
      }).catch(handlePhotoError);
    } else {
      appendNewPhotos(record).then(() => {
        state.records = [...state.records, record];
        finalizeRecordSave(record);
        showToast('紀錄已新增');
      }).catch(handlePhotoError);
    }
  }

  function finalizeRecordSave(record) {
    updateRouteStatus(record);
    persistState();
    renderAll();
    exitEditMode();
    closeDialog(dom.recordDialog);
  }

  function handlePhotoError(error) {
    console.error(error);
    showToast('照片處理失敗，請稍後再試', true);
  }

  function handleResetForm() {
    state.currentPhotos = [];
    updateExistingPhotoChips();
    if (dom.durationHours) {
      dom.durationHours.value = '';
    }
  }

  function exitEditMode() {
    state.currentEditId = null;
    state.currentPhotos = [];
    dom.cancelEdit.classList.add('hidden');
    dom.deleteRecord?.classList.add('hidden');
    dom.existingPhotos.classList.add('hidden');
    dom.recordForm.reset();
    if (dom.durationHours) {
      dom.durationHours.value = '';
    }
  }

  async function appendNewPhotos(record) {
    const files = Array.from(dom.photos.files);
    if (!files.length) {
      return;
    }
    const uploaded = await Promise.all(files.map(processPhotoFile));
    record.photos = [...record.photos, ...uploaded];
  }

  function processPhotoFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const driveInfo = await simulateDriveUpload(file);
          resolve({
            id: driveInfo.driveId,
            name: file.name,
            mimeType: file.type,
            preview: reader.result,
            driveUrl: driveInfo.url,
            uploadedAt: new Date().toISOString()
          });
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function simulateDriveUpload(file) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          driveId: `demo-${createId()}`,
          url: `https://drive.google.com/file/d/demo-${encodeURIComponent(file.name)}`
        });
      }, 300);
    });
  }

  function updateRouteStatus(record) {
    const match = state.routes.find((route) => route.name === record.routeName);
    if (match) {
      match.status = 'completed';
      match.lastHikedDate = record.date;
      match.isChallenge = false;
      if (Number.isFinite(record.distanceKm)) {
        match.distanceKm = record.distanceKm;
      }
      if (Number.isFinite(record.elevationGain)) {
        match.elevationGain = record.elevationGain;
      }
      if (Number.isFinite(record.durationHours)) {
        match.durationHours = record.durationHours;
      }
    } else {
      state.routes.push({
        id: createId(),
        name: record.routeName,
        category: record.category,
        status: 'completed',
        lastHikedDate: record.date,
        notes: record.notes?.slice(0, 80) ?? '',
        isChallenge: false,
        distanceKm: Number.isFinite(record.distanceKm) ? record.distanceKm : null,
        elevationGain: Number.isFinite(record.elevationGain) ? record.elevationGain : null,
        durationHours: Number.isFinite(record.durationHours) ? record.durationHours : null
      });
    }
  }

  function persistState() {
    localStorage.setItem(storageKeys.records, JSON.stringify(state.records));
    localStorage.setItem(storageKeys.routes, JSON.stringify(state.routes));
  }

  function persistProfile() {
    localStorage.setItem(storageKeys.profile, JSON.stringify(state.profile));
  }

  function renderProfileHeader() {
    if (dom.profileAvatar) {
      dom.profileAvatar.src = state.profile.avatarUrl || DEFAULT_AVATAR;
    }
    if (dom.profileDisplayName) {
      const displayName = state.profile.name?.trim() || '旅者';
      dom.profileDisplayName.textContent = displayName;
      dom.profileDisplayName.parentElement?.setAttribute('title', displayName);
    }
  }

  function renderAll() {
    renderRouteSuggestions();
    renderStats();
    renderCarousel();
    renderRecordList();
    renderCompletedRoutes();
    renderChallengeList();
  }

  function setStatsScope(scope) {
    if (!scope || state.statsScope === scope) {
      updateScopeButtons();
      return;
    }
    state.statsScope = scope;
    updateScopeButtons();
    renderStats();
  }

  function updateScopeButtons() {
    dom.scopeButtons?.forEach((button) => {
      const isActive = button.dataset.statsScope === state.statsScope;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  }

  function renderRouteSuggestions() {
    dom.routeSuggestions.innerHTML = '';
    const uniqueNames = new Set(state.routes.map((route) => route.name));
    state.records.forEach((record) => uniqueNames.add(record.routeName));
    uniqueNames.forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      dom.routeSuggestions.append(option);
    });
  }

  function renderStats() {
    updateScopeButtons();

    const currentYear = new Date().getFullYear();
    const scopedRecords = state.statsScope === 'year'
      ? state.records.filter((record) => record.date && new Date(record.date).getFullYear() === currentYear)
      : [...state.records];

    const totalDistance = scopedRecords.reduce((sum, record) => sum + (Number.isFinite(record.distanceKm) ? record.distanceKm : 0), 0);
    const totalElevation = scopedRecords.reduce((sum, record) => sum + (Number.isFinite(record.elevationGain) ? record.elevationGain : 0), 0);
    const totalDuration = scopedRecords.reduce((sum, record) => sum + (Number.isFinite(record.durationHours) ? record.durationHours : 0), 0);

    const distanceFormatter = new Intl.NumberFormat('zh-Hant', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    });
    const elevationFormatter = new Intl.NumberFormat('zh-Hant');
    const durationFormatter = new Intl.NumberFormat('zh-Hant', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    });

    const distanceValue = totalDistance ? distanceFormatter.format(totalDistance) : '0';
    const elevationValue = totalElevation ? elevationFormatter.format(Math.round(totalElevation)) : '0';
    const durationValue = totalDuration ? durationFormatter.format(totalDuration) : '0';

    const completedRouteNames = new Set(scopedRecords.map((record) => record.routeName));
    const historicalRouteCount = state.routes.filter((route) => route.status === 'completed').length;
    const totalRoutes = state.statsScope === 'year'
      ? completedRouteNames.size
      : (historicalRouteCount || completedRouteNames.size);
    const totalRoutesDisplay = new Intl.NumberFormat('zh-Hant').format(totalRoutes);

    dom.homeStats.innerHTML = '';

    const smallWrapper = document.createElement('div');
    smallWrapper.className = 'small-stats';

    const smallStats = [
      { icon: '📏', label: '總里程 (km)', value: distanceValue },
      { icon: '⬆️', label: '總爬升 (m)', value: elevationValue },
      { icon: '⏱️', label: '總時數 (h)', value: durationValue }
    ];

    smallStats.forEach(({ icon, label, value }) => {
      const card = document.createElement('div');
      card.className = 'stat-card small';
      card.innerHTML = `
        <span class="stat-icon" aria-hidden="true">${icon}</span>
        <div class="stat-body">
          <span class="stat-label">${label}</span>
          <span class="stat-value">${value}</span>
        </div>
      `;
      smallWrapper.append(card);
    });

    dom.homeStats.append(smallWrapper);

    const totalCard = document.createElement('div');
    totalCard.className = 'stats-total-card';
    const totalLabel = state.statsScope === 'year' ? '今年完成路線 (條)' : '歷史完成路線 (條)';
    totalCard.innerHTML = `
      <div class="stat-total-body">
        <span class="stat-total-label">${totalLabel}</span>
        <span class="stat-total-value">${totalRoutesDisplay}</span>
      </div>
      <span class="stat-total-icon" aria-hidden="true">🏆</span>
    `;

    dom.homeStats.append(totalCard);
  }

  function renderCarousel() {
    const featuredRecords = [...state.records]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 3);

    dom.carouselTrack.innerHTML = '';
    dom.carouselDots.innerHTML = '';
    const controls = dom.carousel?.querySelector('.carousel-controls');
    controls?.classList.toggle('hidden', featuredRecords.length <= 1);

    if (!featuredRecords.length) {
      const emptySlide = document.createElement('div');
      emptySlide.className = 'carousel-slide';
      emptySlide.innerHTML = `
        <div class="slide-info" style="grid-column: 1 / -1;">
          <h3>目前沒有回憶</h3>
          <p>新增健行紀錄後，這裡會呈現你的精選回憶。</p>
        </div>`;
      dom.carouselTrack.append(emptySlide);
      dom.carouselDots.classList.add('hidden');
      return;
    }

    dom.carouselDots.classList.remove('hidden');

    featuredRecords.forEach((record, index) => {
      const slide = document.createElement('div');
      slide.className = 'carousel-slide';

      const previewPhoto = record.photos?.[0];
      const imageWrapper = document.createElement('div');
      imageWrapper.className = 'slide-image';
      const img = document.createElement('img');
      img.src = previewPhoto?.preview || DEFAULT_RECORD_IMAGE;
      img.alt = `${record.routeName} 精選回憶`;
      img.loading = 'lazy';
      if (previewPhoto) {
        img.addEventListener('click', () => openPhotoPreview(previewPhoto));
      } else {
        img.dataset.placeholder = 'true';
      }
      imageWrapper.append(img);

      const info = document.createElement('div');
      info.className = 'slide-info';
      const detailParts = [];

      info.innerHTML = `
        <h3>${record.routeName}</h3>
        <p class="slide-meta">${record.date}</p>
      `;

      slide.append(imageWrapper, info);
      dom.carouselTrack.append(slide);

      const dot = document.createElement('button');
      dot.type = 'button';
      dot.dataset.slide = index;
      dot.addEventListener('click', () => moveCarouselTo(index));
      dom.carouselDots.append(dot);
    });

    moveCarouselTo(Math.min(state.carouselIndex, featuredRecords.length - 1));
  }

  function moveCarousel(direction) {
    const slideCount = dom.carouselTrack.children.length;
    if (slideCount === 0) return;
    let nextIndex = state.carouselIndex + direction;
    if (nextIndex < 0) nextIndex = slideCount - 1;
    if (nextIndex >= slideCount) nextIndex = 0;
    moveCarouselTo(nextIndex);
  }

  function moveCarouselTo(index) {
    state.carouselIndex = index;
    dom.carouselTrack.style.transform = `translateX(-${index * 100}%)`;
    [...dom.carouselDots.children].forEach((dot, dotIndex) => {
      dot.classList.toggle('active', dotIndex === index);
    });
  }

  function startCarouselAuto() {
    stopCarouselAuto();
    if (dom.carouselTrack.children.length <= 1) return;
    state.carouselTimer = setInterval(() => moveCarousel(1), 5000);
  }

  function stopCarouselAuto() {
    if (state.carouselTimer) {
      clearInterval(state.carouselTimer);
      state.carouselTimer = null;
    }
  }

  function renderRecordList() {
    const filtered = getFilteredRecords();
    const sorted = filtered.sort((a, b) => (a.date < b.date ? 1 : -1));
    dom.recordList.innerHTML = '';

    if (!sorted.length) {
      const empty = document.createElement('p');
      empty.textContent = '尚無符合條件的紀錄。';
      empty.style.color = 'var(--muted-text)';
      dom.recordList.append(empty);
      return;
    }

    sorted.forEach((record) => {
      const item = document.createElement('article');
      item.className = 'record-item';
      item.dataset.id = record.id;

      const thumb = document.createElement('div');
      thumb.className = 'record-thumb';
      const previewPhoto = record.photos?.[0];
      const thumbImg = document.createElement('img');
      thumbImg.src = previewPhoto?.preview || DEFAULT_RECORD_IMAGE;
      thumbImg.alt = `${record.routeName} 照片`;
      thumbImg.loading = 'lazy';
      if (previewPhoto) {
        thumbImg.addEventListener('click', () => openPhotoPreview(previewPhoto));
      } else {
        thumbImg.dataset.placeholder = 'true';
      }
      thumb.append(thumbImg);

      const info = document.createElement('div');
      info.className = 'record-info';

      const title = document.createElement('h3');
      title.textContent = record.routeName;

      const date = document.createElement('span');
      date.className = 'record-meta';
      date.textContent = `完成日期：${record.date}`;

      info.append(title, date);
      item.append(thumb, info);
      item.addEventListener('click', () => enterEditMode(record.id));
      dom.recordList.append(item);
    });
  }

  function getFilteredRecords() {
    if (!dom.searchKeyword && !dom.filterCategory && !dom.filterStart && !dom.filterEnd) {
      return [...state.records];
    }

    const keyword = dom.searchKeyword?.value?.trim().toLowerCase() ?? '';
    const category = dom.filterCategory?.value ?? '';
    const start = dom.filterStart?.value ?? '';
    const end = dom.filterEnd?.value ?? '';

    return state.records.filter((record) => {
      const matchesKeyword = !keyword ||
        record.routeName.toLowerCase().includes(keyword) ||
        record.notes.toLowerCase().includes(keyword);
      const matchesCategory = !category || record.category === category;
      const matchesStart = !start || record.date >= start;
      const matchesEnd = !end || record.date <= end;
      return matchesKeyword && matchesCategory && matchesStart && matchesEnd;
    });
  }

  function renderCompletedRoutes() {
    const completed = state.routes.filter((route) => route.status === 'completed');
    dom.completedList.innerHTML = '';

    if (!completed.length) {
      const empty = document.createElement('p');
      empty.textContent = '還沒有完成的路線，挑戰自己吧！';
      empty.style.color = 'var(--muted-text)';
      dom.completedList.append(empty);
      return;
    }

    completed.sort((a, b) => (a.lastHikedDate < b.lastHikedDate ? 1 : -1))
      .forEach((route) => {
        const card = document.createElement('div');
        card.className = 'route-summary-card';

        const info = document.createElement('div');
        info.className = 'route-summary-info';
        info.innerHTML = `<span><strong>${route.name}</strong> <span class="badge" style="margin-left:8px;">${route.category}</span></span>`;

        const detailParts = [];
        if (Number.isFinite(route.distanceKm)) {
          detailParts.push(`${route.distanceKm.toFixed(1)} km`);
        }
        if (Number.isFinite(route.elevationGain)) {
          detailParts.push(`${Math.round(route.elevationGain)} m`);
        }
        if (detailParts.length) {
          const detail = document.createElement('span');
          detail.className = 'route-summary-meta';
          detail.textContent = detailParts.join(' · ');
          info.append(detail);
        }

        const status = document.createElement('span');
        status.textContent = `最後健行：${route.lastHikedDate || '未紀錄'}`;

        card.append(info, status);
        dom.completedList.append(card);
      });
  }

  function renderChallengeList() {
    const keyword = dom.challengeSearch.value.trim().toLowerCase();
    const filter = dom.challengeFilter.value;

    let routes = [...state.routes];
    if (keyword) {
      routes = routes.filter((route) =>
        route.name.toLowerCase().includes(keyword) ||
        route.notes?.toLowerCase().includes(keyword)
      );
    }

    if (filter === 'pending') {
      routes = routes.filter((route) => route.status === 'pending');
    } else if (filter === 'challenge') {
      routes = routes.filter((route) => route.isChallenge);
    } else if (filter === 'completed') {
      routes = routes.filter((route) => route.status === 'completed');
    }

    dom.challengeList.innerHTML = '';

    if (!routes.length) {
      const empty = document.createElement('li');
      empty.textContent = '找不到符合條件的路線。';
      empty.style.color = 'var(--muted-text)';
      dom.challengeList.append(empty);
      return;
    }

    routes.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')).forEach((route) => {
      const item = document.createElement('li');
      item.className = 'challenge-item';
      item.dataset.id = route.id;

      const meta = document.createElement('div');
      meta.className = 'challenge-meta';
      const detailParts = [];
      if (Number.isFinite(route.distanceKm)) {
        detailParts.push(`${route.distanceKm.toFixed(1)} km`);
      }
      if (Number.isFinite(route.elevationGain)) {
        detailParts.push(`${Math.round(route.elevationGain)} m`);
      }
      meta.innerHTML = `
        <h3>${route.name} <span class="badge" style="margin-left:8px;">${route.category}</span></h3>
        <p>${route.status === 'completed' ? `最後健行：${route.lastHikedDate}` : '尚未完成'}</p>
        ${detailParts.length ? `<p class="route-detail">${detailParts.join(' · ')}</p>` : ''}
        ${route.notes ? `<p>備註：${route.notes}</p>` : ''}
      `;

      const actions = document.createElement('div');
      actions.className = 'challenge-actions';

      const toggleChallenge = document.createElement('button');
      toggleChallenge.type = 'button';
      toggleChallenge.className = route.isChallenge ? 'btn-secondary' : 'btn-primary';
      toggleChallenge.dataset.action = 'toggle-challenge';
      toggleChallenge.dataset.id = route.id;
      toggleChallenge.textContent = route.isChallenge ? '取消挑戰' : '加入挑戰';
      actions.append(toggleChallenge);

      if (route.status !== 'completed') {
        const startBtn = document.createElement('button');
        startBtn.type = 'button';
        startBtn.className = 'btn-secondary';
        startBtn.dataset.action = 'start-record';
        startBtn.dataset.id = route.id;
        startBtn.textContent = '紀錄完成';
        actions.append(startBtn);
      }

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-secondary';
      removeBtn.dataset.action = 'remove-route';
      removeBtn.dataset.id = route.id;
      removeBtn.textContent = '移除';
      actions.append(removeBtn);

      item.append(meta, actions);
      dom.challengeList.append(item);
    });
  }

  function handleRecordListClick(event) {
    const action = event.target.dataset.action;
    if (!action) return;

    const { id } = event.target.dataset;
    if (!id) return;

    if (action === 'edit') {
      enterEditMode(id);
    } else if (action === 'delete') {
      deleteRecord(id);
    }
  }

  function enterEditMode(id) {
    const record = state.records.find((item) => item.id === id);
    if (!record) return;

    state.currentEditId = id;
    state.currentPhotos = [...(record.photos || [])];

    dom.recordDialogTitle.textContent = '編輯健行紀錄';
    dom.cancelEdit.classList.remove('hidden');
    dom.deleteRecord?.classList.remove('hidden');

    dom.routeName.value = record.routeName;
    dom.routeCategory.value = record.category;
    dom.hikeDate.value = record.date;
    dom.distanceKm.value = record.distanceKm != null ? record.distanceKm : '';
    dom.elevationGain.value = record.elevationGain != null ? record.elevationGain : '';
    dom.durationHours.value = record.durationHours != null ? record.durationHours : '';
    dom.notes.value = record.notes;

    updateExistingPhotoChips();
    dom.photos.value = '';

    openDialog(dom.recordDialog);
  }

  function updateExistingPhotoChips() {
    dom.existingPhotos.innerHTML = '';
    if (!state.currentPhotos.length) {
      dom.existingPhotos.classList.add('hidden');
      return;
    }

    dom.existingPhotos.classList.remove('hidden');
    state.currentPhotos.forEach((photo, index) => {
      const chip = document.createElement('div');
      chip.className = 'photo-chip';
      chip.dataset.index = String(index);

      const img = document.createElement('img');
      img.src = photo.preview;
      img.alt = photo.name;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.dataset.index = String(index);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        state.currentPhotos.splice(index, 1);
        updateExistingPhotoChips();
      });

      chip.append(img, removeBtn);
      dom.existingPhotos.append(chip);
    });
  }

  function deleteRecord(id) {
    const record = state.records.find((item) => item.id === id);
    if (!record) return;
    if (!confirm(`確定要刪除 ${record.routeName} 的紀錄嗎？`)) {
      return;
    }
    state.records = state.records.filter((item) => item.id !== id);
    persistState();
    renderAll();
    showToast('紀錄已刪除');
  }

  function handleDeleteFromDialog() {
    if (!state.currentEditId) return;
    const target = state.records.find((item) => item.id === state.currentEditId);
    if (!target) return;
    if (!confirm(`確定要刪除 ${target.routeName} 的紀錄嗎？`)) {
      return;
    }
    deleteRecord(state.currentEditId);
    closeDialog(dom.recordDialog);
    exitEditMode();
  }

  function clearFilters() {
    if (dom.searchKeyword) dom.searchKeyword.value = '';
    if (dom.filterCategory) dom.filterCategory.value = '';
    if (dom.filterStart) dom.filterStart.value = '';
    if (dom.filterEnd) dom.filterEnd.value = '';
    renderRecordList();
  }

  function handleAddRoute(event) {
    event.preventDefault();
    const name = dom.newRouteName.value.trim();
    const category = dom.newRouteCategory.value;
    const notes = dom.newRouteNotes.value.trim();
    const distanceValue = parseFloat(dom.newRouteDistance.value);
    const elevationValue = parseFloat(dom.newRouteElevation.value);

    if (!name) {
      showToast('請輸入路線名稱', true);
      return;
    }

    const exists = state.routes.some((route) => route.name === name);
    if (exists) {
      showToast('路線已存在，請直接更新紀錄', true);
      return;
    }

    state.routes.push({
      id: createId(),
      name,
      category,
      status: 'pending',
      lastHikedDate: null,
      notes,
      isChallenge: true,
      distanceKm: Number.isFinite(distanceValue) ? distanceValue : null,
      elevationGain: Number.isFinite(elevationValue) ? elevationValue : null
    });

    persistState();
    renderAll();
    showToast('未完成路線已新增');
    dom.addRouteForm.reset();
    closeDialog(dom.routeDialog);
  }

  function handleChallengeActions(event) {
    const action = event.target.dataset.action;
    if (!action) return;

    const routeId = event.target.dataset.id;
    const route = state.routes.find((item) => item.id === routeId);
    if (!route) return;

    if (action === 'toggle-challenge') {
      route.isChallenge = !route.isChallenge;
      showToast(route.isChallenge ? '已加入挑戰清單' : '已從挑戰清單移除');
    }

    if (action === 'start-record') {
      prefillFormFromRoute(route);
      switchView('records');
    }

    if (action === 'remove-route') {
      if (!confirm(`確定要移除 ${route.name} 嗎？`)) return;
      state.routes = state.routes.filter((item) => item.id !== routeId);
      showToast('路線已移除');
    }

    persistState();
    renderAll();
  }

  function prefillFormFromRoute(route) {
    enterNewRecordMode({
      routeName: route.name,
      category: route.category,
      distanceKm: route.distanceKm,
      elevationGain: route.elevationGain,
      durationHours: route.durationHours
    });
    dom.hikeDate.focus();
  }

  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (dialog.open) {
      dialog.close();
    }
  }

  function populateProfileForm() {
    dom.profileName.value = state.profile.name || '';
    dom.profileEmail.value = state.profile.email || '';
    dom.profileAvatarUrl.value = state.profile.avatarUrl && state.profile.avatarUrl !== DEFAULT_AVATAR
      ? state.profile.avatarUrl
      : '';
    dom.profileBio.value = state.profile.bio || '';
  }

  function handleProfileSubmit(event) {
    event.preventDefault();
    state.profile = {
      name: dom.profileName.value.trim(),
      email: dom.profileEmail.value.trim(),
      bio: dom.profileBio.value.trim(),
      avatarUrl: dom.profileAvatarUrl.value.trim() || DEFAULT_AVATAR
    };
    persistProfile();
    renderProfileHeader();
    showToast('個人資料已儲存');
  }

  function openPhotoPreview(photo) {
    dom.previewImage.src = photo.preview;
    dom.previewImage.alt = photo.name;
    openDialog(dom.previewDialog);
  }

  function showToast(message, isError = false) {
    dom.toast.textContent = message;
    dom.toast.style.borderColor = isError ? 'rgba(255, 107, 129, 0.65)' : 'rgba(158, 212, 255, 0.65)';
    dom.toast.classList.add('show');
    clearTimeout(dom.toast.timeoutId);
    dom.toast.timeoutId = setTimeout(() => dom.toast.classList.remove('show'), 2600);
  }

  init();
})();
