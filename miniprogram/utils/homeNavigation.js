const defaults = [
  { key: 'newest', label: '上新', visible: true, adminVisible: true },
  { key: 'sales', label: '销量', visible: true, adminVisible: true },
  { key: 'stock', label: '现货', visible: true, adminVisible: true }
];
const homeTab = { key: 'home', label: '首页', visible: true, adminVisible: true };
const configurationDefaults = [homeTab, ...defaults];

function normalize(config) {
  if (!config || !Array.isArray(config.tabs)
      || ![defaults.length, configurationDefaults.length].includes(config.tabs.length)) {
    throw new Error('首页导航配置不完整');
  }
  const seen = new Set();
  const tabs = config.tabs.map(tab => {
    const entry = tab && configurationDefaults.find(item => item.key === tab.key);
    if (!entry || seen.has(tab.key) || typeof tab.visible !== 'boolean'
        || (tab.adminVisible !== undefined && typeof tab.adminVisible !== 'boolean')) throw new Error('首页导航配置无效');
    seen.add(tab.key);
    return { ...entry, visible: tab.visible, adminVisible: tab.adminVisible === undefined ? tab.visible : tab.adminVisible };
  });
  // 兼容升级前的三项配置，首页默认显示在最前，原有三项顺序和开关保持不变。
  if (tabs.length === defaults.length) {
    if (seen.has('home')) throw new Error('首页导航配置不完整');
    return [{ ...homeTab }, ...tabs];
  }
  return tabs;
}

function apply(page, tabs, isAdmin = !!page.data.isAdmin) {
  const mainTabs = normalize({ tabs }).filter(tab => (isAdmin ? tab.adminVisible : tab.visible)
    && (page._includeHomeTab || tab.key !== 'home'));
  const previous = page.data.currentMainTab;
  const keepSelection = page._navigationLoaded || page._navigationExplicitTab;
  const currentMainTab = keepSelection && mainTabs.some(tab => tab.label === previous)
    ? previous : (mainTabs[0] || defaults[0]).label;
  page._navigationLoaded = true;
  page.setData({ mainTabs, currentMainTab });
  return currentMainTab !== previous;
}

async function load(page, api, isAdmin = () => !!page.data.isAdmin) {
  if (page._navigationTask) return page._navigationTask;
  const task = (async () => {
    try {
      const config = await api.get('/home-navigation');
      if (!page._pageClosed) return apply(page, normalize(config), !!isAdmin());
    } catch (error) {
      console.error('加载首页导航配置失败，保留当前展示:', error);
    }
    return false;
  })();
  page._navigationTask = task;
  try { return await task; } finally { if (page._navigationTask === task) page._navigationTask = null; }
}

module.exports = { defaults, homeTab, configurationDefaults, normalize, apply, load };
