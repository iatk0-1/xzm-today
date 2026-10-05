const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function beijingParts(timestamp = Date.now()) {
  const value = new Date(timestamp + SHANGHAI_OFFSET_MS);
  const pad = n => String(n).padStart(2, '0');
  return {
    date: `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`,
    time: `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`
  };
}

function buildSchedule(date, time, status, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new Error('请选择定时日期和时间');
  }
  const executeAt = `${date}T${time}:00+08:00`;
  const timestamp = Date.parse(executeAt);
  const parts = beijingParts(timestamp);
  if (!Number.isFinite(timestamp) || parts.date !== date || parts.time !== time) {
    throw new Error('日期或时间无效，请重新选择');
  }
  if (timestamp <= now) throw new Error('定时日期和时间必须晚于当前时间');
  if (status !== 'on' && status !== 'off') throw new Error('请选择上架或下架动作');
  return { executeAt, status };
}

function scheduleSummary(schedule) {
  if (!schedule || schedule.cancelled || schedule.state === 'cancelled') return '';
  const parts = beijingParts(Date.parse(schedule.executeAt));
  const action = schedule.status === 'on' ? '上架' : '下架';
  const result = schedule.state === 'skipped' ? `（已跳过：${schedule.resultMessage || '未满足执行条件'}）`
    : schedule.state === 'executed' ? '（已执行）' : '';
  return `${parts.date} ${parts.time} 定时${action}${result}`;
}

function hasPendingSchedule(schedule) {
  return !!(schedule && !schedule.cancelled && (!schedule.state || schedule.state === 'pending')
    && (schedule.status === 'on' || schedule.status === 'off') && Number.isFinite(Date.parse(schedule.executeAt)));
}

module.exports = { beijingParts, buildSchedule, scheduleSummary, hasPendingSchedule };
