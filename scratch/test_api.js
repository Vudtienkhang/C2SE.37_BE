import { getComprehensiveStats } from '../services/admin.stats.service.js';

async function check() {
  const stats = await getComprehensiveStats();
  console.log('--- TOP DRIVERS ---');
  stats.topDrivers.forEach(d => {
    console.log(`Driver: ${d.name}, Trips: ${d.trips}, CompletionRate: ${d.completionRate}%`);
  });
}

check().catch(console.error).finally(() => process.exit());
