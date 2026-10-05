// 工作台的固定入口定义；本地排序只能改变位置，不能改变角色权限和跳转地址。
const entries = [
  { id: 'productManage', label: '商品上下架管理', url: '/pages/adminProduct/adminProduct', roles: ['admin', 'stall_manager'] },
  { id: 'inventory', label: '库存管理', url: '/pages/skuInventory/skuInventory', roles: ['admin'] },
  { id: 'picking', label: '拣货推荐', url: '/pages/pickingList/pickingList', roles: ['admin', 'stall_manager'] },
  { id: 'orderManage', label: '订单管理', url: '/pages/adminOrderManage/adminOrderManage', roles: ['admin'] },
  { id: 'shipping', label: '订单发货管理', url: '/pages/adminOrder/adminOrder', roles: ['admin'] },
  { id: 'printers', label: '打印员管理', url: '/pages/logistics/printers/printers', roles: ['admin'] },
  { id: 'afterSale', label: '售后管理', url: '/pages/adminAfterSaleList/adminAfterSaleList', roles: ['admin'] },
  { id: 'shippingSales', label: '售出数量统计', url: '/pages/adminShippingSales/adminShippingSales', roles: ['admin'] },
  { id: 'sales', label: '销售数据', url: '/pages/adminSales/adminSales', roles: ['admin', 'stall_manager'] },
  { id: 'catalog', label: '档口与标签管理', url: '/pages/adminCatalogManage/adminCatalogManage', roles: ['admin'] },
  { id: 'managers', label: '档口负责人管理', url: '/pages/stallManagers/stallManagers', roles: ['admin'] },
  { id: 'pricing', label: '计价规则管理', url: '/pages/pricingRules/pricingRules', roles: ['admin'] },
  { id: 'commission', label: '佣金配置', url: '/pages/commissionConfigs/commissionConfigs', roles: ['admin'] },
  { id: 'income', label: '我的收入与提现', url: '/pages/managerIncome/managerIncome', roles: ['stall_manager'] },
  { id: 'applications', label: '用户申请审批管理', url: '/pages/adminChangeRequestManage/adminChangeRequestManage', roles: ['admin'] }
];

function findEntry(id) {
  return entries.find(entry => entry.id === id);
}

function getOrderedEntries(role, savedOrder) {
  const allowed = entries.filter(entry => entry.roles.includes(role));
  const ids = Array.isArray(savedOrder) ? savedOrder : [];
  const ordered = [];
  for (const id of ids) {
    const entry = allowed.find(item => item.id === id);
    if (entry && !ordered.includes(entry)) ordered.push(entry);
  }
  // 新入口或损坏缓存中遗漏的入口自动追加，不能因旧排序而丢失功能。
  return ordered.concat(allowed.filter(entry => !ordered.includes(entry))).map(entry => ({ ...entry }));
}

function getStorageKey(info) {
  if (!info || !['admin', 'stall_manager'].includes(info.role)) return '';
  const account = info.userId || info.id || info.openid;
  return account ? `workbenchOrder:v1:${String(account)}:${info.role}` : '';
}

function createLayout(items, width, scale) {
  const gap = 16 * scale;
  const itemWidth = (width - gap * 2) / 3;
  const itemHeight = 112 * scale;
  const stepX = itemWidth + gap;
  const stepY = itemHeight + gap;
  const rows = Math.ceil(items.length / 3);
  return {
    itemWidth, itemHeight, stepX, stepY,
    height: rows ? rows * stepY - gap : 0,
    items: items.map((item, index) => ({ ...item, x: (index % 3) * stepX, y: Math.floor(index / 3) * stepY }))
  };
}

function getDropIndex(x, y, layout, count) {
  const column = Math.max(0, Math.min(2, Math.round(x / layout.stepX)));
  const row = Math.max(0, Math.min(Math.ceil(count / 3) - 1, Math.round(y / layout.stepY)));
  return Math.min(count - 1, row * 3 + column);
}

function moveEntry(items, from, to) {
  const result = items.slice();
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}

module.exports = { findEntry, getOrderedEntries, getStorageKey, createLayout, getDropIndex, moveEntry };
