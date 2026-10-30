const { binding: promotionBinding } = require('./productPromotions');
const api = require('./api');
const auth = require('./auth');
const draft = require('./draft');
const finance = require('./managerFinance');
const { getPurchaseNotice } = require('./purchaseNotice');

// 保留结果尚未确认的请求，批量重试时原样重发，避免超时后重复创建商品。
const pending = new Map();

function remote(value, label, required = false) {
  if (!value && !required) return null;
  if (!draft.isRemoteUrl(value)) throw new Error(label + '缺失或尚未上传，请继续编辑后再发布');
  return value;
}

async function buildProduct(record) {
  const data = record.draftData || {};
  const live = record.draftType.startsWith('live_');
  const editing = ['edit', 'live_edit'].includes(record.draftType);
  const manual = auth.isAdmin() && !auth.isStallManager() && !live;
  const stalls = data.selectedStalls || [];
  if (!String(data.title || '').trim()) throw new Error('请先填写商品名称');
  if (stalls.length > 1) throw new Error('商品最多只能选择一个档口');
  if (auth.isStallManager() && !stalls.length && !editing) throw new Error('请先选择分配给你的档口');
  const images = (data.mediaList || []).map(item => remote(typeof item === 'string' ? item : item.url, '商品图片', true));
  const video = remote(data.videoUrl, '视频');
  const videoCover = !live && data.useVideoCover;
  const cover = videoCover ? remote(data.videoThumbPath, '视频封面', true) : images[0];
  if (!cover || (videoCover && !video)) throw new Error('请先补齐商品封面');
  const defaultCost = String(data.costPrice == null ? '' : data.costPrice).trim()
    ? finance.money(data.costPrice) : null;
  let ruleId = data.pricingRuleId ? String(data.pricingRuleId) : null;
  let segments = data.pricingRuleSegments || [];
  if (!manual) {
    if (!ruleId) throw new Error('请选择有效计价规则');
    let rule;
    if (auth.isStallManager() && stalls.length) {
      const assigned = await api.get('/stalls/' + encodeURIComponent(String(stalls[0].id)) + '/pricing-rules');
      const choices = Array.isArray(assigned) ? assigned : assigned ? [assigned] : [];
      rule = choices.find(item => String(item.id) === ruleId);
    } else rule = await api.get('/pricing-rules/' + encodeURIComponent(ruleId));
    if (rule && rule.enabled && !rule.deleted) segments = rule.segments || [];
    else {
      if (!editing) throw new Error('计价规则已失效，请继续编辑后选择有效规则');
      const existing = await api.get('/products/' + encodeURIComponent(String(record.relatedId)) + '?manage=true');
      const ids = ((existing.product || {}).stallIds || []).map(String);
      if (String(existing.pricingRuleId) !== ruleId || ids.join(',') !== stalls.map(item => String(item.id)).join(',')) {
        throw new Error('计价规则已失效，请继续编辑后选择有效规则');
      }
      segments = existing.pricingRuleSegments || [];
    }
    if (!segments.length) throw new Error('计价规则内容为空，请继续编辑后核对');
  }
  const prices = new Map();
  const buildSku = async (sku, groupId) => {
    const rawCost = sku.costPrice || defaultCost;
    const cost = String(rawCost == null ? '' : rawCost).trim() ? finance.money(rawCost) : null;
    let price;
    if (manual) price = finance.money(sku.price);
    else {
      if (cost === null) throw new Error('请填写每条SKU的成本，或设置默认成本');
      if (!prices.has(cost)) prices.set(cost, api.post('/pricing-rules/preview', {
        segments: segments.map(({ label, ...segment }) => segment), cost
      }).then(value => finance.money(value.price)));
      price = await prices.get(cost);
    }
    const stock = String(sku.stock == null ? '' : sku.stock).trim();
    if (stock && (!/^\d+$/.test(stock) || Number(stock) > 999999999)) throw new Error('库存必须为0到999999999的整数');
    return { spec: sku.color || '默认', size: sku.size || '均码', barcode: '',
      retailPrice: Number(price), costPrice: cost, stockMain: stock === '' ? 0 : Number(stock),
      isUnlimitedStock: stock === '', imageUrl: remote(sku.image, 'SKU图片'), sizeId: sku.sizeId || null,
      ...(editing ? { id: sku.skuId || undefined, bundleGroupId: groupId || sku.bundleGroupId || undefined } : {}) };
  };
  const buildRows = async (rows, groupId) => {
    const active = (rows || []).filter(sku => !sku._toBeRemoved);
    if (!active.length) throw new Error('请先补齐商品尺码颜色');
    return Promise.all(active.map(sku => buildSku(sku, groupId)));
  };
  let groups = null;
  let skus;
  if (data.isBundleMode) {
    if (!(data.bundleGroups || []).length) throw new Error('请先补齐套装子项');
    groups = await Promise.all(data.bundleGroups.map(async (group, index) => ({
      name: group.name || '子项' + (index + 1), sortOrder: index,
      skus: await buildRows(group.skuList, group.id)
    })));
    skus = groups.reduce((all, group) => all.concat(group.skus), []);
  } else skus = await buildRows(data.skuList);
  const values = skus.map(sku => sku.retailPrice);
  const min = Math.min(...values), max = Math.max(...values);
  return { name: String(data.title).trim(), costPrice: defaultCost, pricingRuleId: ruleId,
    coverUrl: cover, bannerImages: videoCover ? images : images.slice(1), videoUrl: video,
    stallIds: stalls.map(item => item.id), relateTagIds: (data.selectedTags || []).map(item => item.id),
    status: 'on', retailPrice: min, displayPrice: min === max ? String(min) : min + ' - ' + max,
    sizeCategoryId: data.currentSizeCategoryId || null,
    skus: groups && !editing ? [] : skus, bundleGroups: editing ? undefined : groups,
    ...(!live ? {
      articleNo: String(data.articleNo || '').trim(),
      promotions: promotionBinding(data.promotions),
      schedule: data.productScheduleDirty ? data.productSchedule : undefined,
      useVideoCover: !!videoCover,
      lookbookImages: (data.lookbookImgs || []).map(url => remote(url, '搭配图片', true)),
      detailImages: (data.detailImgs || []).map(url => remote(url, '详情图片', true)),
      relatedProductIds: (data.manualRelated || []).map(item => typeof item === 'object' ? item.id : item),
      shippingInfo: data.shippingInfo || null, description: data.description || null,
      fabricCare: data.fabricCare || null, sizeChartTip: data.sizeChartTip || null,
      warmTips: data.warmTips || null, purchaseNotice: getPurchaseNotice(data.purchaseNotice)
    } : {}) };
}

async function publishDraft(item) {
  if (!auth.isAdmin() && !auth.isStallManager()) throw new Error('请切换到商品管理身份后发布');
  const user = auth.getUserInfo() || {};
  const key = String(user.userId || user.id || '') + ':' + item.id + ':' + item.version;
  let body = pending.get(key);
  if (!body) {
    const record = await draft.loadDraft(item.id);
    draft.editorOptions(record);
    if (String(record.version) !== String(item.version)) throw new Error('草稿已更新，请刷新后重新选择');
    if (record.capabilities && !record.capabilities.edit) throw new Error((record.warnings || []).join('；') || '该草稿暂不能发布，请继续编辑核对');
    const context = { draftType: record.draftType, relatedId: record.relatedId || null, sessionId: record.sessionId || null };
    if (!record.contextToken && ['edit', 'live_edit'].includes(record.draftType)) throw new Error('历史草稿需先继续编辑，核对当前商品后再发布');
    const contextToken = record.contextToken || (await draft.context(context)).token;
    body = { ...context, contextToken, sourceDraftId: String(record.id), sourceDraftVersion: record.version,
      requestKey: draft.createKey(), productData: await buildProduct(record) };
    pending.set(key, body);
  }
  try {
    const result = await draft.submit(body);
    pending.delete(key);
    return result;
  } catch (error) {
    if (error.statusCode >= 400 && error.statusCode < 500) pending.delete(key);
    throw error;
  }
}

module.exports = { publishDraft };
