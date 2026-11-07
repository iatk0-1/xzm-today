// 商品管理台与首页选品框共用筛选参数，保持名称、货号、档口和标签的搜索口径一致。
function build({ activeStatus, page, pageSize, searchKeyword, selectedStall, selectedTag }) {
  const params = { status: activeStatus, page, size: pageSize, manage: true };
  const keyword = (searchKeyword || '').trim();
  if (keyword) params.keyword = keyword;
  if (selectedStall) params.stallId = selectedStall;
  if (selectedTag) params.tagId = selectedTag;
  return params;
}
module.exports = { build };
