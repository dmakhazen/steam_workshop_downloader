const STORAGE_KEYS = {
  lists: 'steammod_lists',
  activeListId: 'steammod_active_list',
  selectedGame: 'steammod_selected_game',
  preferredProxy: 'steammod_preferred_proxy'
};

const GAMES = [
  { name: 'RimWorld', appid: '294100' },
  { name: 'Stardew Valley', appid: '413150' },
  { name: 'Terraria', appid: '105600' }
];

const state = {
  lists: [],
  activeListId: null,
  selectedGame: '294100',
  catalogMods: [],
  catalogFiltered: [],
  catalogPage: 1,
  catalogViewMode: 'default',
  isCatalogLoading: false,
  lastLoadedPage: 0,
  catalogTotalInSteam: 0,
  catalogSessionLoadedIds: new Set(),
  catalogContextKey: '',
  catalogParseMode: '—',
  catalogExtractedCount: 0,
  catalogPageCooldownUntil: 0,
  autoFullCatalog: false,
  preferredProxy: 'auto'
};

const elements = {
  gameSelect: document.getElementById('gameSelect'),
  sortSelect: document.getElementById('sortSelect'),
  searchWrap: document.getElementById('searchWrap'),
  searchInput: document.getElementById('searchInput'),
  tagsInput: document.getElementById('tagsInput'),
  daysSelect: document.getElementById('daysSelect'),
  catalogPageDisplay: document.getElementById('catalogPageDisplay'),
  catalogPrevPageBtn: document.getElementById('catalogPrevPageBtn'),
  catalogNextPageBtn: document.getElementById('catalogNextPageBtn'),
  catalogGoPageInput: document.getElementById('catalogGoPageInput'),
  catalogGoPageBtn: document.getElementById('catalogGoPageBtn'),
  loadCatalogBtn: document.getElementById('loadCatalogBtn'),
  catalogLoadProgress: document.getElementById('catalogLoadProgress'),
  catalogAutoFullToggle: document.getElementById('catalogAutoFullToggle'),
  catalogSteamSearchInput: document.getElementById('catalogSteamSearchInput'),
  catalogMinSubsSelect: document.getElementById('catalogMinSubsSelect'),
  catalogMinStarsSelect: document.getElementById('catalogMinStarsSelect'),
  catalogTagPresetSelect: document.getElementById('catalogTagPresetSelect'),
  catalogSortSelect: document.getElementById('catalogSortSelect'),
  catalogCountSelect: document.getElementById('catalogCountSelect'),
  catalogStatus: document.getElementById('catalogStatus'),
  proxyPrioritySelect: document.getElementById('proxyPrioritySelect'),
  proxyStatus: document.getElementById('proxyStatus'),
  catalogDebug: document.getElementById('catalogDebug'),
  catalogStats: document.getElementById('catalogStats'),
  catalogMods: document.getElementById('catalogMods'),
  viewDefaultBtn: document.getElementById('viewDefaultBtn'),
  viewLargeBtn: document.getElementById('viewLargeBtn'),
  viewListBtn: document.getElementById('viewListBtn'),
  listsContainer: document.getElementById('listsContainer'),
  createListBtn: document.getElementById('createListBtn'),
  activeListName: document.getElementById('activeListName'),
  modLinkInput: document.getElementById('modLinkInput'),
  modNameInput: document.getElementById('modNameInput'),
  addModBtn: document.getElementById('addModBtn'),
  modsContainer: document.getElementById('modsContainer'),
  exportJsonBtn: document.getElementById('exportJsonBtn'),
  importJsonInput: document.getElementById('importJsonInput'),
  downloadBatBtn: document.getElementById('downloadBatBtn'),
  downloadShBtn: document.getElementById('downloadShBtn'),
  openSteamCmdModalBtn: document.getElementById('openSteamCmdModalBtn'),
  steamCmdModal: document.getElementById('steamCmdModal'),
  closeSteamCmdModalBtn: document.getElementById('closeSteamCmdModalBtn'),
  openAltDownloadModalBtn: document.getElementById('openAltDownloadModalBtn'),
  altDownloadModal: document.getElementById('altDownloadModal'),
  closeAltDownloadModalBtn: document.getElementById('closeAltDownloadModalBtn'),
  altServiceSelect: document.getElementById('altServiceSelect'),
  downloadAllAltBtn: document.getElementById('downloadAllAltBtn'),
  modDetailModal: document.getElementById('modDetailModal'),
  modDetailTitle: document.getElementById('modDetailTitle'),
  closeModDetailBtn: document.getElementById('closeModDetailBtn'),
  modDetailBody: document.getElementById('modDetailBody'),
  sidebar: document.getElementById('sidebar'),
  sidebarToggle: document.getElementById('sidebarToggle')
};

const detailCache = new Map();
const detailInFlight = new Map();
const PAGINATION_LABELS = {
  prev: '← Пред',
  next: 'След →',
  go: 'Перейти',
  wait: 'Подождите'
};

function getHostLabel(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return String(url || 'unknown');
  }
}

function setProxyStatus({ phase = 'Загрузка', url = '', status = null, ok = null, message = '' } = {}) {
  if (!elements.proxyStatus) {
    return;
  }

  elements.proxyStatus.classList.remove('proxy-status--info', 'proxy-status--ok', 'proxy-status--error');

  if (ok === true) {
    elements.proxyStatus.classList.add('proxy-status--ok');
  } else if (ok === false) {
    elements.proxyStatus.classList.add('proxy-status--error');
  } else {
    elements.proxyStatus.classList.add('proxy-status--info');
  }

  const statusText = Number.isFinite(Number(status)) ? `HTTP ${status}` : 'без HTTP статуса';
  const hostText = url ? ` · ${getHostLabel(url)}` : '';
  const suffix = message ? ` · ${message}` : '';
  const verdict = ok === true ? 'успех' : ok === false ? 'ошибка' : 'ожидание';

  elements.proxyStatus.textContent = `${phase}: ${verdict} · ${statusText}${hostText}${suffix}`;
}

function setCatalogLoading(loading, text = '') {
  state.isCatalogLoading = loading;
  elements.loadCatalogBtn.disabled = loading;
  elements.catalogLoadProgress.classList.toggle('hidden', !loading && !text);
  elements.catalogLoadProgress.textContent = text || (loading ? 'Загрузка...' : '');
  updateCatalogPageUI();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCatalogPageCooldownActive() {
  return Date.now() < state.catalogPageCooldownUntil;
}

function setCatalogPageCooldown(ms = 1000) {
  state.catalogPageCooldownUntil = Date.now() + Math.max(0, Number(ms) || 0);
  updateCatalogPageUI();
  setTimeout(() => {
    if (Date.now() >= state.catalogPageCooldownUntil) {
      state.catalogPageCooldownUntil = 0;
      updateCatalogPageUI();
    }
  }, Math.max(0, Number(ms) || 0) + 20);
}

function reorderProxyUrls(proxyUrls) {
  const preferred = state.preferredProxy;
  if (!Array.isArray(proxyUrls) || preferred === 'auto') {
    return proxyUrls;
  }

  const matches = (url) => {
    const host = getHostLabel(url);
    if (preferred === 'rjina') {
      return host.includes('r.jina.ai');
    }

    if (preferred === 'allorigins') {
      return host.includes('allorigins.win');
    }

    return false;
  };

  const priority = proxyUrls.filter((url) => matches(url));
  const rest = proxyUrls.filter((url) => !matches(url));
  return [...priority, ...rest];
}

function uniqueId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeListName(name) {
  return (name || 'mods').trim().replace(/\s+/g, '_').replace(/[^\wа-яА-ЯёЁ-]/g, '_');
}

function parseWorkshopId(url) {
  const match = String(url).match(/[?&]id=(\d+)/);
  return match ? match[1] : null;
}

function saveState() {
  localStorage.setItem(STORAGE_KEYS.lists, JSON.stringify(state.lists));
  localStorage.setItem(STORAGE_KEYS.activeListId, state.activeListId || '');
  localStorage.setItem(STORAGE_KEYS.selectedGame, state.selectedGame);
  localStorage.setItem(STORAGE_KEYS.preferredProxy, state.preferredProxy);
}

function loadState() {
  try {
    const storedLists = JSON.parse(localStorage.getItem(STORAGE_KEYS.lists) || '[]');
    state.lists = Array.isArray(storedLists) ? storedLists : [];
  } catch {
    state.lists = [];
  }

  const storedActive = localStorage.getItem(STORAGE_KEYS.activeListId);
  const storedGame = localStorage.getItem(STORAGE_KEYS.selectedGame);
  const storedPreferredProxy = localStorage.getItem(STORAGE_KEYS.preferredProxy);

  state.activeListId = storedActive || null;
  state.selectedGame = GAMES.some((game) => game.appid === storedGame) ? storedGame : '294100';
  state.preferredProxy = ['auto', 'rjina', 'allorigins'].includes(storedPreferredProxy) ? storedPreferredProxy : 'auto';

  if (state.lists.length === 0) {
    const defaultList = {
      id: uniqueId('list'),
      name: 'Мой первый список',
      appid: '294100',
      mods: []
    };
    state.lists = [defaultList];
    state.activeListId = defaultList.id;
    state.selectedGame = '294100';
    saveState();
    return;
  }

  const activeExists = state.lists.some((list) => list.id === state.activeListId);
  if (!activeExists) {
    state.activeListId = state.lists[0].id;
  }
}

function getActiveList() {
  return state.lists.find((list) => list.id === state.activeListId) || null;
}

function buildCatalogUrl(page = state.catalogPage) {
  const base = 'https://steamcommunity.com/workshop/browse/';
  const steamQuery = elements.catalogSteamSearchInput.value.trim();
  const sidebarSort = elements.sortSelect.value;
  const sort = steamQuery ? 'textsearch' : sidebarSort;
  const params = new URLSearchParams({
    appid: state.selectedGame,
    browsesort: sort,
    section: 'readytouseitems'
  });

  if (steamQuery) {
    params.set('searchtext', steamQuery);
  } else if (sort === 'textsearch') {
    const query = elements.searchInput.value.trim();
    if (query) {
      params.set('searchtext', query);
    }
  }

  const tags = elements.tagsInput.value.trim();
  if (tags) {
    params.set('requiredtags', tags);
  }

  const days = elements.daysSelect.value;
  if (days) {
    params.set('days', days);
  }

  const count = Number(elements.catalogCountSelect.value || 15);
  if (count) {
    params.set('numperpage', String(Math.max(30, count)));
  }

  const targetPage = Math.max(1, Number(page || 1));
  params.set('p', String(targetPage));
  return `${base}?${params.toString()}`;
}

function normalizeModTitle(title) {
  return String(title || '')
    .replace(/!\[Image[^\]]*\]\([^)]*\)/gi, ' ')
    .replace(/^Image\s+\d+\]\([^)]*\)\.?/i, ' ')
    .replace(/^\[|\]$/g, '')
    .replace(/^\[+|\]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeImageUrl(url) {
  return String(url || '').replace(/\s+/g, '').replace(/^http:\/\//i, 'https://');
}

function isLikelyImageUrl(url) {
  const value = normalizeImageUrl(url);
  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol)) {
      return false;
    }

    const host = parsed.hostname.toLowerCase();
    const allowedHost =
      host.includes('imgur.com') ||
      host.includes('steamusercontent.com') ||
      host.includes('steamstatic.com');

    const path = parsed.pathname.toLowerCase();
    const hasImageExt = /\.(png|jpe?g|gif|webp|apng|bmp)$/.test(path);
    const steamUgcPath = path.includes('/ugc/');
    return allowedHost && (hasImageExt || steamUgcPath);
  } catch {
    return false;
  }
}

function extractTitleFromSnippet(snippet, id) {
  const marker = `](https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;
  let index = 0;

  while (index >= 0) {
    const end = snippet.indexOf(marker, index);
    if (end < 0) {
      break;
    }

    const start = snippet.lastIndexOf('[', end);
    if (start >= 0) {
      const candidate = normalizeModTitle(snippet.slice(start + 1, end));
      if (
        candidate &&
        !/^image\s+\d+$/i.test(candidate) &&
        !candidate.includes('images.steamusercontent.com')
      ) {
        return candidate;
      }
    }

    index = end + marker.length;
  }

  return '';
}

function extractAuthorFromSnippet(snippet) {
  const byIndex = snippet.indexOf('by[');
  if (byIndex < 0) {
    return { author: 'Неизвестный автор', authorUrl: '' };
  }

  const urlMarker = '](https://steamcommunity.com/';
  const textStart = byIndex + 3;
  const textEnd = snippet.indexOf(urlMarker, textStart);
  if (textEnd < 0) {
    return { author: 'Неизвестный автор', authorUrl: '' };
  }

  const urlStart = textEnd + 2;
  const urlEnd = snippet.indexOf(')', urlStart);
  const author = normalizeModTitle(snippet.slice(textStart, textEnd).replace(/^\[/, '')) || 'Неизвестный автор';
  const authorUrl = urlEnd > urlStart ? snippet.slice(urlStart, urlEnd) : '';
  return { author, authorUrl };
}

function parseNumber(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function markdownToHtml(markdown) {
  const normalizedMarkdown = String(markdown || '').replace(/\((https?:\/\/[\s\S]*?)\)/g, (full, url) => `(${String(url).replace(/\s+/g, '')})`);
  let html = escapeHtml(normalizedMarkdown);
  html = html.replace(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g, (full, url) => {
    const normalized = normalizeImageUrl(url);
    if (!isLikelyImageUrl(normalized)) {
      return '';
    }
    return `<img src="${normalized}" alt="description image" loading="lazy" referrerpolicy="no-referrer" />`;
  });
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\n{2,}/g, '</p><p>');
  html = `<p>${html}</p>`;
  html = html.replace(/\n/g, '<br />');
  return html;
}

function markdownToPlain(markdown) {
  const normalizedMarkdown = String(markdown || '').replace(/\((https?:\/\/[\s\S]*?)\)/g, (full, url) => `(${String(url).replace(/\s+/g, '')})`);
  return normalizedMarkdown
    .replace(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g, ' ')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
    .replace(/[*_`>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseStars(starUrl) {
  const match = String(starUrl || '').match(/\/(\d)-star\.png|not-yet\.png/);
  if (!match) {
    return 0;
  }
  return match[1] ? Number(match[1]) : 0;
}

function parseSteamTotalFromMarkdown(text) {
  const content = String(text || '');
  const match = content.match(/Showing\s+\d+-\d+\s+of\s+([\d,\.\s]+)\s+entries/i);
  return match ? parseNumber(match[1]) : 0;
}

function makeCatalogContextKey() {
  return [
    state.selectedGame,
    elements.sortSelect.value,
    elements.catalogSteamSearchInput.value.trim().toLowerCase(),
    elements.searchInput.value.trim().toLowerCase(),
    elements.tagsInput.value.trim().toLowerCase(),
    elements.daysSelect.value,
    elements.catalogCountSelect.value
  ].join('|');
}

function resetCatalogSessionStats() {
  state.catalogSessionLoadedIds = new Set();
  state.lastLoadedPage = 0;
}

function parseBasicModsFromMarkdown(text) {
  const content = String(text || '');
  const byId = new Map();
  const regex = /\[(.*?)\]\(https:\/\/steamcommunity\.com\/sharedfiles\/filedetails\/\?id=(\d+)[^)]*\)/gms;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (String(match[1] || '').startsWith('![Image')) {
      continue;
    }

    const name = normalizeModTitle(match[1]);
    const id = match[2];
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        name: name || `Мод #${id}`,
        url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`,
        author: 'Неизвестный автор',
        authorUrl: '',
        preview: '',
        stars: 0,
        visitors: 0,
        subscribers: 0,
        favorites: 0,
        tags: [],
        description: ''
      });
    }
  }

  const result = [...byId.values()];
  state.catalogParseMode = 'basic';
  state.catalogExtractedCount = result.length;
  return result;
}

function normalizeSteamUrl(url) {
  const value = String(url || '').trim();
  if (!value) {
    return '';
  }

  if (value.startsWith('//')) {
    return `https:${value}`;
  }

  if (value.startsWith('/')) {
    return `https://steamcommunity.com${value}`;
  }

  return value;
}

function parseModsFromHtml(text) {
  const content = String(text || '');
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/html');
  const cards = [...doc.querySelectorAll('.workshopItem')];
  const byId = new Map();

  const collectFromCard = (card) => {
    const linkElement = card.querySelector("a[href*='filedetails/?id=']");
    if (!linkElement) {
      return;
    }

    const href = normalizeSteamUrl(linkElement.getAttribute('href') || '');
    const id = parseWorkshopId(href);
    if (!id || byId.has(id)) {
      return;
    }

    const titleElement = card.querySelector('.workshopItemTitle');
    const authorElement = card.querySelector('.workshopItemAuthorName a, .workshopItemAuthorName');
    const previewElement = card.querySelector("img[src*='steamusercontent'], img.workshopItemPreviewImage, img");
    const starsElement = card.querySelector("img[src*='-star.png'], img[src*='not-yet.png']");

    const name = normalizeModTitle(titleElement?.textContent || linkElement.textContent || `Мод #${id}`) || `Мод #${id}`;
    const author = normalizeModTitle(authorElement?.textContent || 'Неизвестный автор') || 'Неизвестный автор';
    const authorHref = normalizeSteamUrl(authorElement?.getAttribute?.('href') || '');
    const preview = normalizeImageUrl(normalizeSteamUrl(previewElement?.getAttribute?.('src') || ''));

    byId.set(id, {
      id,
      name,
      url: href,
      author,
      authorUrl: authorHref,
      preview,
      stars: parseStars(normalizeSteamUrl(starsElement?.getAttribute?.('src') || '')),
      visitors: 0,
      subscribers: 0,
      favorites: 0,
      tags: [],
      description: ''
    });
  };

  if (cards.length) {
    cards.forEach(collectFromCard);
  }

  if (!byId.size) {
    const links = [...doc.querySelectorAll("a[href*='filedetails/?id=']")];
    links.forEach((linkElement) => {
      const href = normalizeSteamUrl(linkElement.getAttribute('href') || '');
      const id = parseWorkshopId(href);
      if (!id || byId.has(id)) {
        return;
      }

      const name = normalizeModTitle(linkElement.textContent || `Мод #${id}`) || `Мод #${id}`;
      byId.set(id, {
        id,
        name,
        url: href,
        author: 'Неизвестный автор',
        authorUrl: '',
        preview: '',
        stars: 0,
        visitors: 0,
        subscribers: 0,
        favorites: 0,
        tags: [],
        description: ''
      });
    });
  }

  const result = [...byId.values()];
  state.catalogParseMode = 'html';
  state.catalogExtractedCount = result.length;
  return result;
}

function parseRichModsFromMarkdown(text) {
  const content = String(text || '');

  if (/<\s*!doctype\s+html|<\s*html[\s>]/i.test(content)) {
    const htmlParsed = parseModsFromHtml(content);
    if (htmlParsed.length) {
      return htmlParsed;
    }
  }

  const previewRegex = /\[!\[Image[^\]]*\]\((https?:\/\/images\.steamusercontent\.com\/[^)]+)\)\]\(https?:\/\/steamcommunity\.com\/sharedfiles\/filedetails\/\?id=(\d+)[^)]*\)/g;
  const items = [];
  let previewMatch;

  while ((previewMatch = previewRegex.exec(content)) !== null) {
    const preview = normalizeImageUrl(previewMatch[1] || '');
    const id = previewMatch[2] || '';
    if (!id) {
      continue;
    }

    const snippet = content.slice(previewMatch.index, previewMatch.index + 2200);
    const title = extractTitleFromSnippet(snippet, id);
    const authorData = extractAuthorFromSnippet(snippet);
    const starMatch = snippet.match(/https?:\/\/[^\s)]*\/(?:\d-star|not-yet)\.png[^\s)]*/);

    const name = title || `Мод #${id}`;
    const author = authorData.author;
    const authorUrl = authorData.authorUrl;

    if (!items.some((mod) => mod.id === id)) {
      items.push({
        id,
        name,
        url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`,
        author,
        authorUrl,
        preview,
        stars: parseStars(starMatch?.[0] || ''),
        visitors: 0,
        subscribers: 0,
        favorites: 0,
        tags: [],
        description: ''
      });
    }
  }

  if (items.length) {
    const basicItems = parseBasicModsFromMarkdown(content);
    const byId = new Map(basicItems.map((mod) => [mod.id, mod]));

    items.forEach((richMod) => {
      const base = byId.get(richMod.id) || {
        id: richMod.id,
        name: `Мод #${richMod.id}`,
        url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${richMod.id}`,
        author: 'Неизвестный автор',
        authorUrl: '',
        preview: '',
        stars: 0,
        visitors: 0,
        subscribers: 0,
        favorites: 0,
        tags: [],
        description: ''
      };

      byId.set(richMod.id, {
        ...base,
        ...richMod,
        name: richMod.name || base.name,
        author: richMod.author || base.author,
        authorUrl: richMod.authorUrl || base.authorUrl,
        preview: richMod.preview || base.preview
      });
    });

    const rawIds = [...new Set((content.match(/filedetails\/\?id=(\d+)/g) || [])
      .map((entry) => String(entry).match(/id=(\d+)/)?.[1])
      .filter(Boolean))];

    rawIds.forEach((id) => {
      if (byId.has(id)) {
        return;
      }

      byId.set(id, {
        id,
        name: `Мод #${id}`,
        url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`,
        author: 'Неизвестный автор',
        authorUrl: '',
        preview: '',
        stars: 0,
        visitors: 0,
        subscribers: 0,
        favorites: 0,
        tags: [],
        description: ''
      });
    });

    const merged = [...byId.values()];
    state.catalogParseMode = merged.length > items.length ? 'rich+basic' : 'rich';
    state.catalogExtractedCount = merged.length;
    return merged;
  }

  return parseBasicModsFromMarkdown(content);
}

function applyCatalogFilters() {
  const tag = elements.catalogTagPresetSelect.value.trim().toLowerCase();
  const minSubs = Number(elements.catalogMinSubsSelect.value || 0);
  const minStars = Number(elements.catalogMinStarsSelect.value || 0);
  const sort = elements.catalogSortSelect.value;

  let filtered = state.catalogMods.filter((mod) => {
    if (minSubs > 0 && (mod.subscribers || 0) < minSubs) {
      return false;
    }

    if (minStars > 0 && (mod.stars || 0) < minStars) {
      return false;
    }

    if (tag) {
      const hasTag = (mod.tags || []).some((entry) => entry.toLowerCase().includes(tag));
      if (!hasTag) {
        return false;
      }
    }

    return true;
  });

  filtered = filtered.slice();
  if (sort === 'title') {
    filtered.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  } else if (sort === 'subscribers') {
    filtered.sort((a, b) => (b.subscribers || 0) - (a.subscribers || 0));
  } else if (sort === 'favorites') {
    filtered.sort((a, b) => (b.favorites || 0) - (a.favorites || 0));
  } else if (sort === 'rating') {
    filtered.sort((a, b) => (b.stars || 0) - (a.stars || 0));
  }

  state.catalogFiltered = filtered;
  return filtered;
}

async function fetchViaProxy(workshopUrl) {
  const encodedUrl = encodeURIComponent(workshopUrl);
  const proxyUrls = reorderProxyUrls([
    `https://r.jina.ai/http://steamcommunity.com/workshop/browse/?${workshopUrl.split('?')[1] || ''}`,
    `https://api.allorigins.win/raw?url=${encodedUrl}`
  ]);

  let lastError = null;
  for (const proxyUrl of proxyUrls) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(proxyUrl, { method: 'GET' });
        if (!response.ok) {
          setProxyStatus({ phase: 'Каталог через прокси', url: proxyUrl, status: response.status, ok: false });

          if (response.status === 429 && attempt < 2) {
            await sleep(450 * (attempt + 1));
            continue;
          }

          lastError = new Error(`HTTP ${response.status} (${getHostLabel(proxyUrl)})`);
          break;
        }

        const text = await response.text();
        setProxyStatus({ phase: 'Каталог через прокси', url: proxyUrl, status: response.status, ok: true });
        return { text, proxyUrl, status: response.status };
      } catch (error) {
        setProxyStatus({
          phase: 'Каталог через прокси',
          url: proxyUrl,
          ok: false,
          message: error?.message || 'ошибка сети'
        });
        lastError = error;
        break;
      }
    }
  }

  throw lastError || new Error('Не удалось получить данные через прокси');
}

function addCatalogModToActiveList(mod) {
  const activeList = getActiveList();
  if (!activeList) {
    alert('Сначала создайте список.');
    return;
  }

  const exists = activeList.mods.some((entry) => entry.id === mod.id);
  if (exists) {
    alert('Этот мод уже есть в активном списке.');
    return;
  }

  activeList.appid = state.selectedGame;
  activeList.mods.push({ id: mod.id, name: mod.name });
  saveState();
  renderAll();
  renderCatalogMods(applyCatalogFilters());
}

function parseDetailMetadata(text, options = {}) {
  const { full = true } = options;
  const content = String(text || '');

  const descriptionMatch = content.match(/Description\s+([\s\S]*?)\n\s*\d+\s+Comments/i);
  const rawDescriptionMarkdown = descriptionMatch ? descriptionMatch[1].trim() : '';
  const descriptionMarkdown = rawDescriptionMarkdown.replace(/\((https?:\/\/[\s\S]*?)\)/g, (full, url) => `(${String(url).replace(/\s+/g, '')})`);
  const plainDescription = markdownToPlain(descriptionMarkdown);
  const description = full ? plainDescription : compactDescriptionText(plainDescription, 220);
  const descriptionHtml = full ? markdownToHtml(descriptionMarkdown) : '';

  const tags = [];
  const tagRegex = /\[([^\]]+)\]\(https:\/\/steamcommunity\.com\/workshop\/browse\/\?[^)]*requiredtags[^)]*\)/g;
  let tagMatch;
  while ((tagMatch = tagRegex.exec(content)) !== null) {
    const tagName = normalizeModTitle(tagMatch[1]);
    if (tagName && !tags.includes(tagName)) {
      tags.push(tagName);
    }
  }

  const visitorsMatch = content.match(/([\d,\.\s]+)\s+Unique Visitors/i);
  const subscribersMatch = content.match(/([\d,\.\s]+)\s+Current Subscribers/i);
  const favoritesMatch = content.match(/([\d,\.\s]+)\s+Current Favorites/i);
  const ratingsMatch = content.match(/([\d,\.\s]+)\s+ratings/i);

  const sizeMatch = content.match(/([\d.,]+\s*(?:KB|MB|GB))/i);
  const postedMatch = content.match(/Posted\s+([A-Za-z]{3}\s+\d{1,2}(?:\s+@\s+[0-9:apm]+)?)/i);
  const previewMatch = content.match(/\[!\[Image[^\]]*\]\((https?:\/\/images\.steamusercontent\.com\/[^)]+)\)/);
  const descriptionImages = full
    ? [...new Set([
      ...[...descriptionMarkdown.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g)].map((match) => match[1]),
      ...(content.match(/https?:\/\/images\.steamusercontent\.com\/ugc\/[\w/%?=&.-]+/g) || []),
      ...(content.match(/https?:\/\/i\.imgur\.com\/[\w.-]+\.(?:png|jpe?g|gif|webp|apng)/gi) || [])
    ]
      .map((url) => normalizeImageUrl(url))
      .filter((url) => isLikelyImageUrl(url)))].slice(0, 20)
    : [];

  return {
    description,
    descriptionMarkdown,
    descriptionHtml,
    tags,
    visitors: visitorsMatch ? parseNumber(visitorsMatch[1]) : 0,
    subscribers: subscribersMatch ? parseNumber(subscribersMatch[1]) : 0,
    favorites: favoritesMatch ? parseNumber(favoritesMatch[1]) : 0,
    ratings: ratingsMatch ? parseNumber(ratingsMatch[1]) : 0,
    fileSize: sizeMatch ? sizeMatch[1] : '',
    posted: postedMatch ? postedMatch[1] : '',
    preview: previewMatch ? normalizeImageUrl(previewMatch[1]) : '',
    descriptionImages
  };
}

function parseDetailMetadataFromHtml(text, options = {}) {
  const { full = true } = options;
  const content = String(text || '');
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/html');
  const pageText = doc.body?.textContent || '';

  const descriptionElement = doc.querySelector(
    '.workshopItemDescription#highlightContent, #highlightContent .workshopItemDescription, #highlightContent, .workshopItemDescription'
  );

  const descriptionHtml = full ? (descriptionElement?.innerHTML?.trim() || '') : '';
  const plainDescription = markdownToPlain(descriptionElement?.textContent || '');
  const description = full ? plainDescription : compactDescriptionText(plainDescription, 220);
  const descriptionMarkdown = descriptionElement?.textContent?.trim() || '';

  const tags = [...doc.querySelectorAll("a[href*='requiredtags']")]
    .map((node) => normalizeModTitle(node.textContent || ''))
    .filter(Boolean)
    .filter((tag, index, array) => array.indexOf(tag) === index);

  const visitorsMatch = pageText.match(/([\d,\.\s]+)\s+Unique Visitors/i);
  const subscribersMatch = pageText.match(/([\d,\.\s]+)\s+Current Subscribers/i);
  const favoritesMatch = pageText.match(/([\d,\.\s]+)\s+Current Favorites/i);
  const ratingsMatch = pageText.match(/([\d,\.\s]+)\s+ratings/i);

  const sizeMatch = pageText.match(/([\d.,]+\s*(?:KB|MB|GB))/i);
  const postedMatch = pageText.match(/Posted\s+([A-Za-z]{3}\s+\d{1,2}(?:,\s*\d{4})?(?:\s+@\s+[0-9:apm]+)?)/i);

  const previewElement = doc.querySelector("#previewImageMain, img[src*='images.steamusercontent.com']");
  const preview = normalizeImageUrl(normalizeSteamUrl(previewElement?.getAttribute('src') || ''));

  const descriptionImages = full
    ? [...new Set(
      (descriptionElement ? [...descriptionElement.querySelectorAll('img')] : [])
        .map((image) => normalizeImageUrl(normalizeSteamUrl(image.getAttribute('src') || '')))
        .filter((url) => isLikelyImageUrl(url))
    )].slice(0, 20)
    : [];

  return {
    description,
    descriptionMarkdown,
    descriptionHtml,
    tags,
    visitors: visitorsMatch ? parseNumber(visitorsMatch[1]) : 0,
    subscribers: subscribersMatch ? parseNumber(subscribersMatch[1]) : 0,
    favorites: favoritesMatch ? parseNumber(favoritesMatch[1]) : 0,
    ratings: ratingsMatch ? parseNumber(ratingsMatch[1]) : 0,
    fileSize: sizeMatch ? sizeMatch[1] : '',
    posted: postedMatch ? postedMatch[1] : '',
    preview,
    descriptionImages
  };
}

function parseDetailMetadataSmart(text, options = {}) {
  const { full = true } = options;
  const content = String(text || '');
  if (/<\s*!doctype\s+html|<\s*html[\s>]/i.test(content)) {
    const htmlData = parseDetailMetadataFromHtml(content, { full });
    const hasUsefulData = Boolean(
      htmlData.description ||
      htmlData.descriptionHtml ||
      htmlData.tags.length ||
      htmlData.subscribers ||
      htmlData.descriptionImages.length
    );

    if (hasUsefulData) {
      return htmlData;
    }
  }

  return parseDetailMetadata(content, { full });
}

function hasUsefulLiteDetails(details) {
  return Boolean(
    details?.description ||
    details?.subscribers ||
    details?.favorites ||
    details?.visitors ||
    details?.fileSize ||
    (details?.tags && details.tags.length)
  );
}

function hasUsefulFullDetails(details) {
  return Boolean(details?.descriptionHtml || (details?.descriptionImages && details.descriptionImages.length));
}

async function fetchModDetails(mod, options = {}) {
  const { full = false } = options;
  const requestedLevel = full ? 'full' : 'lite';
  const cached = detailCache.get(mod.id);
  if (cached?.data) {
    if (cached.level === 'full' || requestedLevel === 'lite') {
      return cached.data;
    }
  }

  const requestKey = `${mod.id}:${requestedLevel}`;
  if (detailInFlight.has(requestKey)) {
    return detailInFlight.get(requestKey);
  }

  const requestPromise = (async () => {
    const directUrl = `https://steamcommunity.com/sharedfiles/filedetails/?id=${encodeURIComponent(mod.id)}`;
    const proxyUrls = reorderProxyUrls([
      `https://r.jina.ai/http://steamcommunity.com/sharedfiles/filedetails/?id=${encodeURIComponent(mod.id)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(directUrl)}`
    ]);

    let lastError = null;
    for (const proxyUrl of proxyUrls) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let response;
        try {
          response = await fetch(proxyUrl, { method: 'GET' });
        } catch (error) {
          setProxyStatus({
            phase: `Детали мода ${mod.id}`,
            url: proxyUrl,
            ok: false,
            message: error?.message || 'ошибка сети'
          });
          lastError = error;
          break;
        }

        if (!response.ok) {
          setProxyStatus({ phase: `Детали мода ${mod.id}`, url: proxyUrl, status: response.status, ok: false });
          if (response.status === 429 && attempt < 2) {
            await sleep(450 * (attempt + 1));
            continue;
          }
          lastError = new Error(`HTTP ${response.status}`);
          break;
        }

        setProxyStatus({ phase: `Детали мода ${mod.id}`, url: proxyUrl, status: response.status, ok: true });
        const text = await response.text();
        const parsed = parseDetailMetadataSmart(text, { full });
        const existing = detailCache.get(mod.id);
        if (full || !existing?.data) {
          detailCache.set(mod.id, { level: requestedLevel, data: parsed });
        } else if (existing.level !== 'full') {
          detailCache.set(mod.id, { level: 'lite', data: mergeModDetails(existing.data, parsed) });
        }
        return parsed;
      }
    }

    throw lastError || new Error('Не удалось загрузить детали мода через прокси');
  })();

  detailInFlight.set(requestKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    detailInFlight.delete(requestKey);
  }
}

function mergeModDetails(mod, details) {
  return {
    ...mod,
    description: details.description || mod.description || '',
    descriptionMarkdown: details.descriptionMarkdown || mod.descriptionMarkdown || '',
    descriptionHtml: details.descriptionHtml || mod.descriptionHtml || '',
    tags: details.tags?.length ? details.tags : mod.tags || [],
    visitors: details.visitors || mod.visitors || 0,
    subscribers: details.subscribers || mod.subscribers || 0,
    favorites: details.favorites || mod.favorites || 0,
    ratings: details.ratings || mod.ratings || 0,
    fileSize: details.fileSize || mod.fileSize || '',
    posted: details.posted || mod.posted || '',
    preview: normalizeImageUrl(details.preview || mod.preview || ''),
    descriptionImages: details.descriptionImages?.length ? details.descriptionImages : mod.descriptionImages || []
  };
}

function compactDescriptionText(value, maxLength = 170) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trimEnd()}…`;
}

function formatInt(value) {
  return Number(value || 0).toLocaleString('ru-RU');
}

function starsText(stars) {
  if (!stars) {
    return 'Новый';
  }
  return `${'★'.repeat(Math.max(1, Math.min(5, stars)))}${'☆'.repeat(Math.max(0, 5 - stars))}`;
}

function updateCatalogPageUI() {
  elements.catalogPageDisplay.textContent = `Страница: ${state.catalogPage}`;
  const cooldownActive = isCatalogPageCooldownActive();
  const controlsLocked = state.isCatalogLoading || cooldownActive;

  elements.catalogPrevPageBtn.disabled = state.catalogPage <= 1 || controlsLocked;
  elements.catalogNextPageBtn.disabled = controlsLocked;
  elements.catalogGoPageBtn.disabled = controlsLocked;
  elements.catalogGoPageInput.disabled = controlsLocked;

  elements.catalogPrevPageBtn.classList.toggle('wait-state', controlsLocked);
  elements.catalogNextPageBtn.classList.toggle('wait-state', controlsLocked);
  elements.catalogGoPageBtn.classList.toggle('wait-state', controlsLocked);

  if (controlsLocked) {
    elements.catalogPrevPageBtn.textContent = PAGINATION_LABELS.wait;
    elements.catalogNextPageBtn.textContent = PAGINATION_LABELS.wait;
    elements.catalogGoPageBtn.textContent = PAGINATION_LABELS.wait;
  } else {
    elements.catalogPrevPageBtn.textContent = PAGINATION_LABELS.prev;
    elements.catalogNextPageBtn.textContent = PAGINATION_LABELS.next;
    elements.catalogGoPageBtn.textContent = PAGINATION_LABELS.go;
  }

  elements.loadCatalogBtn.textContent = 'Загрузить моды';
}

function setCatalogViewMode(mode) {
  state.catalogViewMode = mode;
  elements.catalogMods.classList.remove('view-default', 'view-large', 'view-list');
  elements.catalogMods.classList.add(`view-${mode}`);

  [
    [elements.viewDefaultBtn, mode === 'default'],
    [elements.viewLargeBtn, mode === 'large'],
    [elements.viewListBtn, mode === 'list']
  ].forEach(([button, active]) => {
    button.classList.toggle('active', active);
  });
}

function updateCatalogStats() {
  const activeList = getActiveList();
  const addedIds = new Set((activeList?.mods || []).map((mod) => mod.id));
  const addedCount = state.catalogMods.filter((mod) => addedIds.has(mod.id)).length;
  elements.catalogStats.textContent = `Всего в Steam: ${formatInt(state.catalogTotalInSteam)} · Загружено в сессии: ${formatInt(state.catalogSessionLoadedIds.size)} · Показано сейчас: ${formatInt(state.catalogFiltered.length)} · Уже в списке: ${addedCount}`;
}

function updateCatalogDebugLine() {
  if (!elements.catalogDebug) {
    return;
  }

  elements.catalogDebug.textContent = `Парсинг: ${state.catalogParseMode} · извлечено карточек: ${state.catalogExtractedCount}`;
}

function getModById(id) {
  return state.catalogMods.find((mod) => mod.id === id) || null;
}

function renderModDetailContent(mod) {
  elements.modDetailTitle.textContent = mod.name || `Мод #${mod.id}`;
  elements.modDetailBody.innerHTML = '';

  const preview = document.createElement('img');
  preview.className = 'mod-detail-preview';
  preview.src = normalizeImageUrl(mod.preview || 'https://community.fastly.steamstatic.com/public/images/sharedfiles/searchbox_workshop_submit.gif');
  preview.alt = mod.name || mod.id;

  const gallery = document.createElement('div');
  gallery.className = 'mod-detail-gallery';
  (mod.descriptionImages || []).slice(0, 8).forEach((imageUrl) => {
    const normalized = normalizeImageUrl(imageUrl);
    if (!isLikelyImageUrl(normalized)) {
      return;
    }

    const image = document.createElement('img');
    image.src = normalized;
    image.alt = 'description image';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    gallery.appendChild(image);
  });

  const descriptionWrap = document.createElement('div');
  descriptionWrap.className = 'mod-detail-description';
  const fullDetailsLoaded = hasUsefulFullDetails(mod);
  if (mod.descriptionHtml?.trim()) {
    descriptionWrap.innerHTML = mod.descriptionHtml;
    descriptionWrap.querySelectorAll('img').forEach((image) => {
      const normalized = normalizeImageUrl(image.getAttribute('src') || '');
      if (!isLikelyImageUrl(normalized)) {
        image.remove();
        return;
      }
      image.src = normalized;
      image.referrerPolicy = 'no-referrer';
      image.loading = 'lazy';
    });
  } else if (mod.description?.trim()) {
    descriptionWrap.textContent = mod.description;
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'catalog-description';
    placeholder.style.maxHeight = 'none';
    placeholder.textContent = 'Описание пока недоступно.';

    descriptionWrap.append(placeholder);
  }

  if (!fullDetailsLoaded) {
    const loadDetailsBtn = document.createElement('button');
    loadDetailsBtn.className = 'accent-btn';
    loadDetailsBtn.textContent = 'Подгрузить детали';
    loadDetailsBtn.addEventListener('click', async () => {
      loadDetailsBtn.disabled = true;
      loadDetailsBtn.textContent = 'Загрузка...';
      try {
        const details = await fetchModDetails(mod, { full: true });
        const merged = mergeModDetails(mod, details);
        const index = state.catalogMods.findIndex((entry) => entry.id === mod.id);
        if (index >= 0) {
          state.catalogMods[index] = merged;
          renderCatalogMods(applyCatalogFilters());
        }
        renderModDetailContent(merged);
      } catch {
        loadDetailsBtn.disabled = false;
        loadDetailsBtn.textContent = 'Повторить подгрузку';
      }
    });

    descriptionWrap.append(loadDetailsBtn);
  }

  const meta = document.createElement('div');
  meta.className = 'mod-detail-meta';
  [
    `Workshop ID: ${mod.id}`,
    `Рейтинг: ${starsText(mod.stars)}`,
    `Подписчики: ${formatInt(mod.subscribers)}`,
    `Избранное: ${formatInt(mod.favorites)}`,
    `Посетители: ${formatInt(mod.visitors)}`,
    mod.fileSize ? `Размер: ${mod.fileSize}` : '',
    mod.posted ? `Опубликован: ${mod.posted}` : ''
  ].filter(Boolean).forEach((text) => {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = text;
    meta.appendChild(badge);
  });

  const author = document.createElement('div');
  author.className = 'catalog-author';
  if (mod.authorUrl) {
    const authorLink = document.createElement('a');
    authorLink.href = mod.authorUrl;
    authorLink.target = '_blank';
    authorLink.rel = 'noopener noreferrer';
    authorLink.textContent = `Автор: ${mod.author}`;
    author.appendChild(authorLink);
  } else {
    author.textContent = `Автор: ${mod.author || 'Неизвестный'}`;
  }

  const tags = document.createElement('div');
  tags.className = 'catalog-tags';
  (mod.tags || []).forEach((entry) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.textContent = entry;
    tags.appendChild(chip);
  });

  const steamLink = document.createElement('a');
  steamLink.href = mod.url;
  steamLink.target = '_blank';
  steamLink.rel = 'noopener noreferrer';
  steamLink.className = 'accent-link';
  steamLink.textContent = 'Открыть страницу мода в Steam';

  if (gallery.childElementCount > 0) {
    elements.modDetailBody.append(preview, gallery, author, meta, tags, descriptionWrap, steamLink);
  } else {
    elements.modDetailBody.append(preview, author, meta, tags, descriptionWrap, steamLink);
  }
}

async function openModDetail(mod) {
  renderModDetailContent(mod);
  elements.modDetailModal.classList.remove('hidden');

  if (hasUsefulLiteDetails(mod)) {
    return;
  }

  try {
    const details = await fetchModDetails(mod, { full: false });
    const merged = mergeModDetails(mod, details);
    const index = state.catalogMods.findIndex((entry) => entry.id === mod.id);
    if (index >= 0) {
      state.catalogMods[index] = merged;
      renderCatalogMods(applyCatalogFilters());
    }
    renderModDetailContent(merged);
  } catch {
  }
}

function renderCatalogMods(mods) {
  updateCatalogDebugLine();
  elements.catalogMods.innerHTML = '';
  if (!mods.length) {
    elements.catalogStatus.textContent = 'Моды не найдены. Измени фильтры и попробуй снова.';
    updateCatalogStats();
    updateCatalogPageUI();
    return;
  }

  elements.catalogStatus.textContent = `Найдено модов: ${mods.length} (из ${state.catalogMods.length})`;
  const activeList = getActiveList();
  const addedIds = new Set((activeList?.mods || []).map((mod) => mod.id));

  mods.forEach((mod) => {
    const card = document.createElement('li');
    card.className = 'catalog-card';
    card.addEventListener('click', () => {
      const latest = getModById(mod.id) || mod;
      openModDetail(latest);
    });

    const preview = document.createElement('img');
    preview.className = 'catalog-preview';
    preview.src = normalizeImageUrl(mod.preview || 'https://community.fastly.steamstatic.com/public/images/sharedfiles/searchbox_workshop_submit.gif');
    preview.alt = mod.name;

    const body = document.createElement('div');
    body.className = 'catalog-body';

    const title = document.createElement('div');
    title.className = 'catalog-title';
    title.textContent = mod.name;

    const author = document.createElement('div');
    author.className = 'catalog-author';
    if (mod.authorUrl) {
      const link = document.createElement('a');
      link.href = mod.authorUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `Автор: ${mod.author}`;
      author.appendChild(link);
    } else {
      author.textContent = `Автор: ${mod.author || 'Неизвестный'}`;
    }

    const badges = document.createElement('div');
    badges.className = 'catalog-badges';
    const badgeValues = [
      `Рейтинг: ${starsText(mod.stars)}`,
      `Подписчики: ${formatInt(mod.subscribers)}`,
      `Избранное: ${formatInt(mod.favorites)}`,
      `Посетители: ${formatInt(mod.visitors)}`,
      mod.fileSize ? `Размер: ${mod.fileSize}` : '',
      mod.posted ? `Опубликован: ${mod.posted}` : ''
    ].filter(Boolean);
    badgeValues.forEach((text) => {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = text;
      badges.appendChild(badge);
    });

    const description = document.createElement('div');
    description.className = 'catalog-description';
    description.textContent = compactDescriptionText(mod.description) || 'Описание доступно после подгрузки деталей в попапе.';

    const tags = document.createElement('div');
    tags.className = 'catalog-tags';
    if (mod.tags?.length) {
      mod.tags.slice(0, 8).forEach((entry) => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.textContent = entry;
        tags.appendChild(chip);
      });
    }

    const meta = document.createElement('div');
    meta.className = 'mod-subtext';
    meta.textContent = `Workshop ID: ${mod.id}`;

    const links = document.createElement('div');
    links.className = 'catalog-links';

    const openLink = document.createElement('a');
    openLink.href = mod.url;
    openLink.target = '_blank';
    openLink.rel = 'noopener noreferrer';
    openLink.className = 'ghost-btn';
    openLink.textContent = 'Открыть';

    const addBtn = document.createElement('button');
    const alreadyAdded = addedIds.has(mod.id);
    addBtn.className = alreadyAdded ? 'ghost-btn added-btn' : 'accent-btn';
    addBtn.textContent = alreadyAdded ? '✓ Уже добавлен' : 'Добавить';
    addBtn.disabled = alreadyAdded;
    addBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      addCatalogModToActiveList(mod);
    });

    openLink.addEventListener('click', (event) => event.stopPropagation());

    links.append(openLink, addBtn);
    body.append(title, author, badges, description, tags, meta, links);
    card.append(preview, body);
    elements.catalogMods.appendChild(card);
  });

  updateCatalogStats();
  updateCatalogPageUI();
}

async function enrichCatalogMods(limit = 12, options = {}) {
  const { allowDuringLoading = false, mode = 'lite' } = options;
  const full = mode === 'full';

  if (state.isCatalogLoading && !allowDuringLoading) {
    elements.catalogStatus.textContent = 'Дождись завершения текущей загрузки каталога.';
    return;
  }

  if (!state.catalogMods.length) {
    if (allowDuringLoading) {
      return;
    }
    alert('Сначала загрузи каталог.');
    return;
  }

  const pending = state.catalogMods
    .filter((mod) => (full ? !hasUsefulFullDetails(mod) : !hasUsefulLiteDetails(mod)))
    .slice(0, limit);
  if (!pending.length) {
    elements.catalogStatus.textContent = full
      ? 'Полные карточки уже загружены.'
      : 'Карточки уже содержат основную информацию.';
    return;
  }

  const statusPrefix = full ? 'Полная подгрузка карточек' : 'Быстрая подгрузка карточек';
  elements.catalogStatus.textContent = `${statusPrefix}: 0/${pending.length}`;
  if (!allowDuringLoading) {
    setCatalogLoading(true, `${statusPrefix}: 0/${pending.length}`);
  }
  const concurrency = full ? 2 : 4;
  let done = 0;
  const queue = [...pending];

  const worker = async () => {
    while (queue.length) {
      const mod = queue.shift();
      if (!mod) {
        return;
      }

      try {
        const details = await fetchModDetails(mod, { full });
        const merged = mergeModDetails(mod, details);
        const index = state.catalogMods.findIndex((entry) => entry.id === mod.id);
        if (index >= 0) {
          state.catalogMods[index] = merged;
        }
      } catch {
      }

      done += 1;
      elements.catalogStatus.textContent = `${statusPrefix}: ${done}/${pending.length}`;
      if (!allowDuringLoading) {
        setCatalogLoading(true, `${statusPrefix}: ${done}/${pending.length}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => worker()));
  if (!allowDuringLoading) {
    setCatalogLoading(false);
  }
  renderCatalogMods(applyCatalogFilters());
}

async function loadCatalogMods(options = {}) {
  const { append = false, page = state.catalogPage } = options;
  if (state.isCatalogLoading) {
    elements.catalogStatus.textContent = 'Загрузка уже выполняется...';
    return;
  }

  const previousPage = state.catalogPage;
  const previousMods = state.catalogMods;
  const previousFiltered = state.catalogFiltered;
  const previousTotalInSteam = state.catalogTotalInSteam;
  const previousSessionIds = new Set(state.catalogSessionLoadedIds);
  const previousLastLoadedPage = state.lastLoadedPage;

  const targetPage = Math.max(1, Number(page || 1));
  state.catalogPage = targetPage;
  const contextKey = makeCatalogContextKey();
  const contextChanged = contextKey !== state.catalogContextKey;
  if (contextChanged) {
    state.catalogContextKey = contextKey;
    state.catalogTotalInSteam = 0;
    state.catalogParseMode = '—';
    state.catalogExtractedCount = 0;
    resetCatalogSessionStats();
  }

  const workshopUrl = buildCatalogUrl(targetPage);
  elements.catalogStatus.textContent = 'Загрузка модов...';
  setCatalogLoading(true, `Подгрузка страницы ${targetPage}...`);
  updateCatalogPageUI();

  try {
    const { text, proxyUrl, status } = await fetchViaProxy(workshopUrl);
    const parsedMods = parseRichModsFromMarkdown(text);
    const selectedCount = Number(elements.catalogCountSelect.value || 15);
    const displayCount = Math.max(15, selectedCount);
    const mods = parsedMods.slice(0, displayCount);
    const rawIds = text.match(/filedetails\/\?id=\d+/g) || [];
    if (parsedMods.length === 0 && rawIds.length > 0) {
      setProxyStatus({
        phase: 'Каталог через прокси',
        url: proxyUrl,
        status,
        ok: false,
        message: `HTTP ${status}, но карточки не распознаны (${rawIds.length} id в ответе)`
      });
    } else if (parsedMods.length === 0) {
      setProxyStatus({
        phase: 'Каталог через прокси',
        url: proxyUrl,
        status,
        ok: false,
        message: `HTTP ${status}, но ответ не содержит карточек` 
      });
    } else {
      setProxyStatus({
        phase: 'Каталог через прокси',
        url: proxyUrl,
        status,
        ok: true,
        message: `распознано: ${parsedMods.length}, показано: ${mods.length}`
      });
    }

    const totalInSteam = parseSteamTotalFromMarkdown(text);
    if (totalInSteam > 0) {
      state.catalogTotalInSteam = totalInSteam;
    }

    const expected = Number(elements.catalogCountSelect.value || 15);
    setCatalogLoading(true, `Подгрузка страницы ${targetPage}: ${mods.length}/${expected}`);

    if (append && mods.length === 0) {
      state.catalogPage = Math.max(1, state.catalogPage - 1);
      elements.catalogStatus.textContent = 'Больше модов не найдено для следующей страницы.';
      setCatalogLoading(false);
      updateCatalogPageUI();
      return;
    }

    if (append) {
      const map = new Map(state.catalogMods.map((mod) => [mod.id, mod]));
      mods.forEach((mod) => {
        if (!map.has(mod.id)) {
          map.set(mod.id, mod);
        }
      });
      state.catalogMods = [...map.values()];
    } else {
      state.catalogMods = mods;
    }

    mods.forEach((mod) => {
      state.catalogSessionLoadedIds.add(mod.id);
    });

    state.lastLoadedPage = targetPage;
    renderCatalogMods(applyCatalogFilters());
    if (state.catalogMods.length && state.autoFullCatalog) {
      await enrichCatalogMods(Math.max(1, state.catalogMods.length), { allowDuringLoading: true, mode: 'full' });
    }
    setCatalogLoading(false);
    updateCatalogPageUI();
  } catch (error) {
    state.catalogPage = previousPage;
    state.catalogMods = previousMods;
    state.catalogFiltered = previousFiltered;
    state.catalogTotalInSteam = previousTotalInSteam;
    state.catalogSessionLoadedIds = previousSessionIds;
    state.lastLoadedPage = previousLastLoadedPage;
    elements.catalogStatus.textContent = `Ошибка загрузки каталога: ${error.message}`;
    elements.loadCatalogBtn.textContent = 'Загрузить моды';
    setCatalogLoading(false);
    renderCatalogMods(applyCatalogFilters());
  }
}

function renderGameOptions() {
  elements.gameSelect.innerHTML = '';
  GAMES.forEach((game) => {
    const option = document.createElement('option');
    option.value = game.appid;
    option.textContent = `${game.name} (${game.appid})`;
    elements.gameSelect.appendChild(option);
  });
  elements.gameSelect.value = state.selectedGame;
}

function renderLists() {
  elements.listsContainer.innerHTML = '';

  state.lists.forEach((list) => {
    const item = document.createElement('li');
    item.className = `list-item ${list.id === state.activeListId ? 'active' : ''}`;

    const head = document.createElement('div');
    head.className = 'list-item-head';

    const selectBtn = document.createElement('button');
    selectBtn.className = 'list-select-btn ghost-btn';
    selectBtn.textContent = list.name;
    selectBtn.title = `AppID: ${list.appid}`;
    selectBtn.addEventListener('click', () => {
      state.activeListId = list.id;
      state.selectedGame = list.appid || state.selectedGame;
      elements.gameSelect.value = state.selectedGame;
      saveState();
      renderAll();
      if (state.catalogMods.length) {
        state.catalogPage = 1;
        loadCatalogMods({ append: false, page: state.catalogPage });
      }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn ghost-btn';
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', () => {
      if (!confirm(`Удалить список "${list.name}"?`)) {
        return;
      }

      state.lists = state.lists.filter((entry) => entry.id !== list.id);
      if (state.lists.length === 0) {
        const freshList = {
          id: uniqueId('list'),
          name: 'Мой первый список',
          appid: state.selectedGame,
          mods: []
        };
        state.lists.push(freshList);
        state.activeListId = freshList.id;
      } else if (state.activeListId === list.id) {
        state.activeListId = state.lists[0].id;
      }

      saveState();
      renderAll();
    });

    head.append(selectBtn, deleteBtn);

    const meta = document.createElement('div');
    meta.className = 'mod-subtext';
    meta.textContent = `AppID: ${list.appid || '—'} · модов: ${(list.mods || []).length}`;

    item.append(head, meta);
    elements.listsContainer.appendChild(item);
  });
}

function renderMods() {
  const activeList = getActiveList();
  elements.modsContainer.innerHTML = '';

  if (!activeList) {
    elements.activeListName.textContent = '—';
    return;
  }

  elements.activeListName.textContent = activeList.name;

  if (!Array.isArray(activeList.mods) || activeList.mods.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'mod-item';
    empty.textContent = 'Пока нет модов в этом списке.';
    elements.modsContainer.appendChild(empty);
    return;
  }

  activeList.mods.forEach((mod) => {
    const item = document.createElement('li');
    item.className = 'mod-item';

    const head = document.createElement('div');
    head.className = 'mod-item-head';

    const title = document.createElement('strong');
    title.textContent = mod.name?.trim() ? mod.name : `Мод #${mod.id}`;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn ghost-btn';
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', () => {
      activeList.mods = activeList.mods.filter((entry) => entry.id !== mod.id);
      saveState();
      renderAll();
    });

    head.append(title, deleteBtn);

    const meta = document.createElement('div');
    meta.className = 'mod-subtext';
    meta.textContent = `Workshop ID: ${mod.id}`;

    item.append(head, meta);
    elements.modsContainer.appendChild(item);
  });
}

function getActiveListWithModsOrAlert() {
  const activeList = getActiveList();
  if (!activeList) {
    alert('Нет активного списка.');
    return null;
  }

  if (!activeList.mods.length) {
    alert('В активном списке нет модов.');
    return null;
  }

  return activeList;
}

function getAltServiceUrls(serviceKey, modId) {
  const encodedId = encodeURIComponent(modId);

  if (serviceKey === 'workshopdl') {
    return [`https://workshopdl.net/?id=${encodedId}`];
  }

  if (serviceKey === 'steamworkshopdownloader') {
    return [`https://steamworkshopdownloader.io/?id=${encodedId}`];
  }

  return [];
}

function downloadAllModsViaAltService() {
  const activeList = getActiveListWithModsOrAlert();
  if (!activeList) {
    return;
  }

  const serviceKey = elements.altServiceSelect.value;
  const allLinks = [];

  activeList.mods.forEach((mod) => {
    const links = getAltServiceUrls(serviceKey, mod.id);
    links.forEach((link) => {
      if (!allLinks.includes(link)) {
        allLinks.push(link);
      }
    });
  });

  if (!allLinks.length) {
    alert('Не удалось подготовить ссылки для выбранного сервиса.');
    return;
  }

  let opened = 0;
  allLinks.forEach((link, index) => {
    setTimeout(() => {
      const popup = window.open(link, '_blank', 'noopener,noreferrer');
      if (popup) {
        opened += 1;
      }
    }, index * 120);
  });

  setTimeout(() => {
    if (opened === 0) {
      downloadTextFile(`${sanitizeListName(activeList.name)}_download_links.txt`, allLinks.join('\n'));
      alert('Браузер заблокировал всплывающие окна. Сохранил файл со ссылками для скачивания.');
    }
  }, allLinks.length * 140 + 200);

  elements.altDownloadModal.classList.add('hidden');
}

function downloadTextFile(fileName, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function generateBatScript(list) {
  const folderName = sanitizeListName(list.name);
  const lines = [
    '@echo off',
    `set LIST_NAME=${folderName}`,
    'steamcmd.exe ^',
    '  +login anonymous ^',
    '  +force_install_dir "./%LIST_NAME%/." ^',
    ...list.mods.map((mod) => `  +workshop_download_item ${list.appid} ${mod.id} ^`),
    '  +quit'
  ];
  return lines.join('\r\n');
}

function generateShScript(list) {
  const folderName = sanitizeListName(list.name);
  const lines = [
    '#!/bin/bash',
    `LIST_NAME="${folderName}"`,
    './steamcmd.sh \\',
    '  +login anonymous \\',
    '  +force_install_dir "$HOME/steamcmd/mods/$LIST_NAME" \\',
    ...list.mods.map((mod) => `  +workshop_download_item ${list.appid} ${mod.id} \\`),
    '  +quit'
  ];
  return lines.join('\n');
}

function createNewList() {
  const rawName = prompt('Введите имя нового списка:');
  if (!rawName) {
    return;
  }

  const listName = rawName.trim();
  if (!listName) {
    return;
  }

  const newList = {
    id: uniqueId('list'),
    name: listName,
    appid: state.selectedGame,
    mods: []
  };

  state.lists.push(newList);
  state.activeListId = newList.id;
  saveState();
  renderAll();
}

function addModToActiveList() {
  const activeList = getActiveList();
  if (!activeList) {
    alert('Сначала создайте список.');
    return;
  }

  const modUrl = elements.modLinkInput.value.trim();
  const modId = parseWorkshopId(modUrl);

  if (!modId) {
    alert('Не удалось найти Workshop ID в ссылке. Ожидается параметр id=...');
    return;
  }

  const alreadyExists = activeList.mods.some((mod) => mod.id === modId);
  if (alreadyExists) {
    alert('Этот мод уже есть в активном списке.');
    return;
  }

  activeList.appid = state.selectedGame;
  activeList.mods.push({
    id: modId,
    name: elements.modNameInput.value.trim()
  });

  elements.modLinkInput.value = '';
  elements.modNameInput.value = '';

  saveState();
  renderAll();
}

function exportActiveList() {
  const activeList = getActiveList();
  if (!activeList) {
    alert('Нет активного списка для экспорта.');
    return;
  }

  const data = {
    name: activeList.name,
    appid: activeList.appid,
    mods: activeList.mods
  };

  const fileName = `${sanitizeListName(activeList.name)}.json`;
  downloadTextFile(fileName, JSON.stringify(data, null, 2));
}

function importListFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result || '{}'));
      if (!data || typeof data !== 'object') {
        throw new Error('Некорректный формат файла');
      }

      const importedName = String(data.name || 'Импортированный список').trim() || 'Импортированный список';
      const importedAppId = String(data.appid || state.selectedGame);
      const importedMods = Array.isArray(data.mods)
        ? data.mods
            .map((mod) => ({ id: String(mod.id || '').trim(), name: String(mod.name || '').trim() }))
            .filter((mod) => /^\d+$/.test(mod.id))
        : [];

      const list = {
        id: uniqueId('list'),
        name: importedName,
        appid: importedAppId,
        mods: importedMods
      };

      state.lists.push(list);
      state.activeListId = list.id;
      state.selectedGame = importedAppId;

      if (!GAMES.some((game) => game.appid === importedAppId)) {
        state.selectedGame = '294100';
      }

      saveState();
      renderAll();
      alert('Список успешно импортирован.');
    } catch (error) {
      alert(`Ошибка импорта: ${error.message}`);
    }
  };

  reader.readAsText(file);
}

function downloadScript(type) {
  const activeList = getActiveListWithModsOrAlert();
  if (!activeList) {
    return;
  }

  if (type === 'bat') {
    const content = generateBatScript(activeList);
    downloadTextFile(`${sanitizeListName(activeList.name)}.bat`, content);
    return;
  }

  const content = generateShScript(activeList);
  downloadTextFile(`${sanitizeListName(activeList.name)}.sh`, content);
}

function renderAll() {
  renderGameOptions();
  renderLists();
  renderMods();
  updateCatalogStats();
  updateCatalogPageUI();
}

function setupEvents() {
  elements.gameSelect.addEventListener('change', () => {
    state.selectedGame = elements.gameSelect.value;
    saveState();
    if (state.catalogMods.length) {
      state.catalogPage = 1;
      loadCatalogMods({ append: false, page: state.catalogPage });
    }
  });

  const workshopFilterChanged = () => {
    const showSearch = elements.sortSelect.value === 'textsearch';
    elements.searchWrap.classList.toggle('hidden', !showSearch);
    if (state.catalogMods.length) {
      state.catalogPage = 1;
      loadCatalogMods({ append: false, page: state.catalogPage });
    }
  };

  elements.sortSelect.addEventListener('change', workshopFilterChanged);
  elements.searchInput.addEventListener('input', workshopFilterChanged);
  elements.tagsInput.addEventListener('input', workshopFilterChanged);
  elements.daysSelect.addEventListener('change', workshopFilterChanged);
  elements.loadCatalogBtn.addEventListener('click', () => {
    const retryPage = Math.max(1, state.catalogPage || 1);
    loadCatalogMods({ append: false, page: retryPage });
  });

  elements.catalogPrevPageBtn.addEventListener('click', () => {
    if (state.isCatalogLoading || isCatalogPageCooldownActive()) {
      return;
    }
    state.catalogPage = Math.max(1, state.catalogPage - 1);
    setCatalogPageCooldown(1000);
    loadCatalogMods({ append: false, page: state.catalogPage });
  });

  elements.catalogNextPageBtn.addEventListener('click', () => {
    if (state.isCatalogLoading || isCatalogPageCooldownActive()) {
      return;
    }
    state.catalogPage += 1;
    setCatalogPageCooldown(1000);
    loadCatalogMods({ append: false, page: state.catalogPage });
  });

  elements.catalogGoPageBtn.addEventListener('click', () => {
    if (state.isCatalogLoading || isCatalogPageCooldownActive()) {
      return;
    }
    const page = Number(elements.catalogGoPageInput.value.trim());
    if (!Number.isFinite(page) || page < 1) {
      return;
    }
    state.catalogPage = Math.floor(page);
    setCatalogPageCooldown(1000);
    loadCatalogMods({ append: false, page: state.catalogPage });
  });

  elements.catalogGoPageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      elements.catalogGoPageBtn.click();
    }
  });

  elements.catalogSteamSearchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      state.catalogPage = 1;
      loadCatalogMods({ append: false, page: state.catalogPage });
    }
  });

  elements.catalogCountSelect.addEventListener('change', () => {
    const hadLoaded = state.catalogMods.length > 0;
    state.catalogPage = 1;
    state.lastLoadedPage = 0;
    state.catalogMods = [];
    renderCatalogMods(applyCatalogFilters());
    if (hadLoaded) {
      loadCatalogMods({ append: false, page: state.catalogPage });
    }
  });

  elements.catalogAutoFullToggle.addEventListener('change', () => {
    state.autoFullCatalog = elements.catalogAutoFullToggle.checked;
    if (!state.autoFullCatalog || !state.catalogMods.length) {
      return;
    }

    enrichCatalogMods(Math.max(1, state.catalogMods.length), { mode: 'full' });
  });

  elements.proxyPrioritySelect.addEventListener('change', () => {
    const selected = elements.proxyPrioritySelect.value;
    state.preferredProxy = ['auto', 'rjina', 'allorigins'].includes(selected) ? selected : 'auto';
    saveState();

    if (state.catalogMods.length) {
      state.catalogPage = 1;
      loadCatalogMods({ append: false, page: state.catalogPage });
    }
  });

  const catalogFilterHandler = () => {
    renderCatalogMods(applyCatalogFilters());
  };
  elements.catalogMinSubsSelect.addEventListener('change', catalogFilterHandler);
  elements.catalogMinStarsSelect.addEventListener('change', catalogFilterHandler);
  elements.catalogTagPresetSelect.addEventListener('change', catalogFilterHandler);
  elements.catalogSortSelect.addEventListener('change', catalogFilterHandler);

  elements.viewDefaultBtn.addEventListener('click', () => setCatalogViewMode('default'));
  elements.viewLargeBtn.addEventListener('click', () => setCatalogViewMode('large'));
  elements.viewListBtn.addEventListener('click', () => setCatalogViewMode('list'));

  elements.createListBtn.addEventListener('click', createNewList);
  elements.addModBtn.addEventListener('click', addModToActiveList);

  elements.modLinkInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      addModToActiveList();
    }
  });

  elements.exportJsonBtn.addEventListener('click', exportActiveList);
  elements.importJsonInput.addEventListener('change', (event) => {
    const [file] = event.target.files || [];
    if (file) {
      importListFromFile(file);
    }
    event.target.value = '';
  });

  elements.downloadBatBtn.addEventListener('click', () => downloadScript('bat'));
  elements.downloadShBtn.addEventListener('click', () => downloadScript('sh'));

  elements.openSteamCmdModalBtn.addEventListener('click', () => {
    elements.steamCmdModal.classList.remove('hidden');
  });

  elements.closeSteamCmdModalBtn.addEventListener('click', () => {
    elements.steamCmdModal.classList.add('hidden');
  });

  elements.steamCmdModal.addEventListener('click', (event) => {
    if (event.target === elements.steamCmdModal) {
      elements.steamCmdModal.classList.add('hidden');
    }
  });

  elements.openAltDownloadModalBtn.addEventListener('click', () => {
    elements.altDownloadModal.classList.remove('hidden');
  });

  elements.closeAltDownloadModalBtn.addEventListener('click', () => {
    elements.altDownloadModal.classList.add('hidden');
  });

  elements.altDownloadModal.addEventListener('click', (event) => {
    if (event.target === elements.altDownloadModal) {
      elements.altDownloadModal.classList.add('hidden');
    }
  });

  elements.downloadAllAltBtn.addEventListener('click', downloadAllModsViaAltService);

  elements.closeModDetailBtn.addEventListener('click', () => {
    elements.modDetailModal.classList.add('hidden');
  });

  elements.modDetailModal.addEventListener('click', (event) => {
    if (event.target === elements.modDetailModal) {
      elements.modDetailModal.classList.add('hidden');
    }
  });

  elements.sidebarToggle.addEventListener('click', () => {
    elements.sidebar.classList.toggle('open');
  });

  document.querySelector('.main-content').addEventListener('click', () => {
    elements.sidebar.classList.remove('open');
  });
}

function init() {
  loadState();
  if (elements.catalogAutoFullToggle) {
    elements.catalogAutoFullToggle.checked = false;
  }
  state.autoFullCatalog = false;
  if (elements.proxyPrioritySelect) {
    elements.proxyPrioritySelect.value = state.preferredProxy;
  }
  renderAll();
  updateCatalogDebugLine();
  setupEvents();
  setCatalogViewMode('default');
  elements.searchWrap.classList.toggle('hidden', elements.sortSelect.value !== 'textsearch');
}

init();
