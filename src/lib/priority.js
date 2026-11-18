/** Priority levels: High, Medium, Low (or none). */
export const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
export const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
/** Pickers list the levels from none up, like the marker's filled bars. */
export const PRIORITY_CHOICES = [
  { value: null, label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' }
];
