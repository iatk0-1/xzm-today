const defaults = [
  { key: 'newest', label: '上新', visible: true },
  { key: 'sales', label: '销量', visible: true },
  { key: 'stock', label: '现货', visible: true }
];

function normalize(config) {
  if (!config || !Array.isArray(config.tabs) || config.tabs.length !== defaults.length) {
    throw new Error('首页导航配置不完整');
  }
  const seen = new Set();
  return config.tabs.map(tab => {
    const entry = tab && defaults.find(item => item.key === tab.key);
    if (!entry || seen.has(tab.key) || typeof tab.visible !== 'boolean') throw new Error('首页导航配置无效');
    seen.add(tab.key);
    return { ...entry, visible: tab.visible };
  });
}

function apply(page, tabs) {
  const mainTabs = tabs.filter(tab => tab.visible);
  const previous = page.data.currentMainTab;
  const keepSelection = page._navigationLoaded || page._navigationExplicitTab;
  const currentMainTab = keepSelection && mainTabs.some(tab => tab.label === previous)
    ? previous : (mainTabs[0] || defaults[0]).label;
  page._navigationLoaded = true;
  page.setData({ mainTabs, currentMainTab });
  return currentMainTab !== previous;
}

async function load(page, api) {
  if (page._navigationTask) return page._navigationTask;
  const task = (async () => {
    try {
      const config = await api.get('/home-navigation');
      if (!page._pageClosed) return apply(page, normalize(config));
    } catch (error) {
      console.error('加载首页导航配置失败，保留当前展示:', error);
    }
    return false;
  })();
  page._navigationTask = task;
  try { return await task; } finally { if (page._navigationTask === task) page._navigationTask = null; }
}

module.exports = { defaults, normalize, apply, load };
