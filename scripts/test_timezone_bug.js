// Test the timezone conversion bug

const testDate = new Date('2025-09-04T16:00:00.000Z'); // UTC time at minute boundary
console.log('Original UTC date:', testDate.toISOString());
console.log('Original seconds:', testDate.getSeconds()); // Should be 0

// This is what the code does (WRONG):
const wrongWay = new Date(
  testDate.toLocaleString('en-US', { timeZone: 'UTC' })
);
console.log('\nWrong conversion:');
console.log('  Result:', wrongWay.toISOString());
console.log('  Seconds:', wrongWay.getSeconds());
console.log('  This creates a LOCAL date from string, not UTC!');

// The issue: toLocaleString returns a string like "9/4/2025, 4:00:00 PM"
// When you create a new Date from this, it assumes LOCAL timezone!
console.log(
  '\nThe string produced:',
  testDate.toLocaleString('en-US', { timeZone: 'UTC' })
);

// Correct way would be to use the original date directly
console.log('\nCorrect approach:');
console.log('  Use original Date object directly');
console.log('  UTC Seconds:', testDate.getUTCSeconds());
console.log('  UTC Minutes:', testDate.getUTCMinutes());

// Test cron matching
function matchesCronField(field, value) {
  if (field === '*') return true;
  if (field.includes('/')) {
    const [range, step] = field.split('/');
    const stepNum = Number(step);
    if (range === '*') {
      return value % stepNum === 0;
    }
  }
  return Number(field) === value;
}

// Test if "0 */1 * * * *" would match
const second = wrongWay.getSeconds();
const minute = wrongWay.getMinutes();

console.log('\nCron matching test for "0 */1 * * * *":');
console.log(
  '  Second field "0" matches',
  second,
  '?',
  matchesCronField('0', second)
);
console.log(
  '  Minute field "*/1" matches',
  minute,
  '?',
  matchesCronField('*/1', minute)
);
