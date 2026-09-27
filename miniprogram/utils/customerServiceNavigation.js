function openFromContact(event) {
  const detail = event && event.detail && event.detail.path ? event.detail : event;
  if (!detail || !detail.path) return false;

  const [rawPath, rawQuery = ''] = String(detail.path).split('?');
  const path = '/' + rawPath.replace(/^\/+/, '');
  const query = detail.query || {};
  const pathParams = {};
  rawQuery.split('&').forEach(part => {
    const [key, value] = part.split('=');
    if (key) pathParams[key] = value;
  });
  const id = query.id || pathParams.id;
  if (!/^\d+$/.test(String(id || ''))) return false;

  let url;
  if (path === '/pages/detail/detail') {
    url = `/pages/detail/detail?id=${id}`;
  } else if (path === '/pages/orderDetail/orderDetail') {
    const source = query.fromCustomerService || pathParams.fromCustomerService;
    url = `/pages/orderDetail/orderDetail?id=${id}`;
    if (String(source) === '1') url += '&fromCustomerService=1';
  } else {
    return false;
  }

  wx.navigateTo({ url });
  return true;
}

module.exports = { openFromContact };
