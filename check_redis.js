import redis from './lib/redis.js';

async function checkRedis() {
  try {
    const locations = await redis.geopos('drivers:locations', '1', '2', '4', '5', '17');
    console.log('--- REDIS LOCATIONS ---');
    const driverIds = ['1', '2', '4', '5', '17'];
    for (let i = 0; i < driverIds.length; i++) {
        console.log(`Driver ${driverIds[i]}: ${locations[i] ? JSON.stringify(locations[i]) : 'NOT FOUND'}`);
    }
    
    // Check all drivers in locations
    const allDrivers = await redis.zrange('drivers:locations', 0, -1);
    console.log('All drivers in Redis:', allDrivers);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

checkRedis();
