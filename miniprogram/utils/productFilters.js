// 首页和搜索页使用相同的档口分组规则。
function groupStalls(stalls) {
  function initial(name) {
    if (!name || !name.trim()) return '#';
    const char = name.trim()[0];
    if (/[A-Za-z]/.test(char)) return char.toUpperCase();
    if (!/[\u4e00-\u9fa5]/.test(char)) return '#';
    const letters = 'ABCDEFGHJKLMNOPQRSTWXYZ';
    const boundaries = '阿八嚓哒妸发旮哈讥咔垃痳拿噢妑七呥扨它穵夕丫帀';
    for (let i = 0; i < boundaries.length; i++) {
      if ((!boundaries[i + 1] || boundaries[i + 1].localeCompare(char, 'zh-Hans-CN') > 0)
          && char.localeCompare(boundaries[i], 'zh-Hans-CN') >= 0) return letters[i];
    }
    return '#';
  }
  const groups = {};
  stalls.forEach(stall => {
    const letter = initial(stall.name);
    if (!groups[letter]) groups[letter] = [];
    groups[letter].push(stall);
  });
  return Object.keys(groups).sort((a, b) => a === b ? 0 : a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b))
    .map(letter => ({ letter, list: groups[letter].slice().sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN')) }));
}

module.exports = { groupStalls };
