// 多商品关联按选择顺序展示；兼容旧心愿的单商品字段，ID 始终保留为字符串。
function getLinkedProductIds(wish) {
  const values = Array.isArray(wish.linkedProductIds)
    ? wish.linkedProductIds : (wish.linkedProductId ? [wish.linkedProductId] : []);
  return [...new Set(values.filter(id => id != null && String(id) !== '').map(String))];
}

function productPlaceholder(id) {
  return { id, name: '已关联商品（' + id + '）', coverUrl: '' };
}

async function loadLinkedProducts(wish, fetchProduct) {
  const ids = getLinkedProductIds(wish);
  const products = ids.map(productPlaceholder);
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const index = next++;
      try {
        const result = await fetchProduct(ids[index]);
        const product = result.product || result;
        const firstImage = Array.isArray(product.bannerImages) ? product.bannerImages[0] : '';
        products[index] = { ...product, id: ids[index], name: product.name || products[index].name,
          coverUrl: product.coverUrl || firstImage || '' };
      } catch (err) {
        // 一个商品失效不影响其他商品，也不丢失原关联。
        products[index] = { ...products[index], name: '商品暂不可用' };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker));
  return products;
}

module.exports = { getLinkedProductIds, productPlaceholder, loadLinkedProducts };
