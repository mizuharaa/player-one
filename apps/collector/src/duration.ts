/** Display server durations in hours above two hours without rounding their fraction. */
export function taskDuration(minutes: number, tt: (key: 'taskCard.hours' | 'detail.minutes') => string): string {
  if (minutes <= 120) return `${minutes} ${tt('detail.minutes')}`;
  const [whole, fraction] = String(minutes).split('.');
  const remainder = `${Number(whole) % 60}${fraction ? `.${fraction}` : ''}`;
  return `${Math.floor(minutes / 60)} ${tt('taskCard.hours')}${Number(remainder) ? ` ${remainder} ${tt('detail.minutes')}` : ''}`;
}
