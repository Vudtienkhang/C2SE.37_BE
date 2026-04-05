import prisma from '../prisma/prisma.js';
import redis from '../lib/redis.js';
import * as weatherService from './weather.service.js';
import * as dateTimeHelper from '../lib/dateTime.helper.js';


/**
 * Calculates trip price based on distance, duration, and conditions.
 * Includes automated surcharges and system fee.
 * 
 * @param {Object} params - Calculation parameters
 * @returns {Promise<Object>} Price breakdown and total
 */
export const calculateTripPrice = async ({
  distanceKm,
  durationMin,
  vehicleType,
  pickupLat,
  pickupLng,
  weather = 'auto'
}) => {
  // Normalize vehicle types (e.g., 'car' -> 'car_4')
  let normalizedType = vehicleType;
  if (normalizedType === 'car') normalizedType = 'car_4';

  if (distanceKm < 0 || durationMin < 0) {
    throw new Error('Distance and duration must be non-negative.');
  }

  // 1. Get active PricingConfig (With Redis Cache)
  const cacheKey = `pricing:config:${normalizedType}`;
  let config = null;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      config = JSON.parse(cached);
      // console.log(`[PRICING] Cache hit for ${normalizedType}`);
    }
  } catch (redisErr) {
    console.warn('[REDIS] Error reading pricing cache:', redisErr.message);
  }

  if (!config) {
    config = await prisma.pricingConfig.findFirst({
      where: { 
        vehicleType: normalizedType,
        isActive: true 
      }
    });

    if (config) {
      try {
        await redis.set(cacheKey, JSON.stringify(config), 'EX', 3600); // Cache for 1 hour
      } catch (redisErr) {
        console.warn('[REDIS] Error setting pricing cache:', redisErr.message);
      }
    }
  }

  if (!config) {
    throw new Error(`No active pricing configuration found for vehicle type: ${vehicleType}`);
  }

  // 2. Fetch Active Holidays
  const holidays = await prisma.holidayConfig.findMany({
    where: { isActive: true }
  });

  const now = new Date();
  
  // 3. Check Conditions
  const activeHoliday = dateTimeHelper.getActiveHoliday(now, holidays);
  const isNight = dateTimeHelper.isWithinTimeRange(now, config.nightStart, config.nightEnd);
  const isRushHour = dateTimeHelper.isWithinTimeRange(now, config.rushHour1Start, config.rushHour1End) || 
                     dateTimeHelper.isWithinTimeRange(now, config.rushHour2Start, config.rushHour2End);

  // 4. Weather detection
  let weatherFee = 0;
  if (weather === 'auto' || weather === 'rain' || weather === 'storm') {
     if (weather === 'auto') {
        const weatherData = await weatherService.getCurrentWeather(pickupLat, pickupLng);
        if (weatherData?.isBadWeather) {
            weatherFee = config.badWeatherFee;
        }
     } else {
        weatherFee = config.badWeatherFee;
     }
  }

  // 5. Calculate Base Fare
  const distanceFare = distanceKm * config.perKmPrice;
  const timeFare = 0; // Removing per minute cost as requested
  const baseFare = distanceFare + timeFare;

  // 6. Calculate Surcharges (Multipliers on BaseFare)
  let nightSurcharge = 0;
  if (isNight) {
    nightSurcharge = baseFare * (config.nightMultiplier - 1);
  }

  let rushHourSurcharge = 0;
  if (isRushHour) {
    rushHourSurcharge = baseFare * (config.rushHourMultiplier - 1);
  }

  let holidaySurcharge = 0;
  if (activeHoliday) {
    holidaySurcharge = baseFare * (config.holidayMultiplier - 1);
  }

  const surchargeTotal = nightSurcharge + rushHourSurcharge + holidaySurcharge + weatherFee;

  // 7. System Fee
  const systemFee = config.systemFee;

  // 8. Total Price
  const totalPrice = baseFare + surchargeTotal + systemFee;

  return {
    baseFare: Math.round(baseFare),
    surchargeBreakdown: {
      night: Math.round(nightSurcharge),
      rushHour: Math.round(rushHourSurcharge),
      holiday: Math.round(holidaySurcharge),
      weather: Math.round(weatherFee)
    },
    surchargeTotal: Math.round(surchargeTotal),
    systemFee: Math.round(systemFee),
    totalPrice: Math.round(totalPrice),
    appliedMultipliers: {
      night: isNight ? config.nightMultiplier : 1,
      rushHour: isRushHour ? config.rushHourMultiplier : 1,
      holiday: activeHoliday ? config.holidayMultiplier : 1
    }
  };

};


/**
 * Ensures only one active config per vehicleType.
 * @param {string} vehicleType 
 */
export const deactivateOtherConfigs = async (vehicleType) => {
  await prisma.pricingConfig.updateMany({
    where: { 
      vehicleType,
      isActive: true 
    },
    data: { isActive: false }
  });
  
  // Clear cache for this vehicle type
  try {
    let normalizedType = vehicleType;
    if (normalizedType === 'car') normalizedType = 'car_4';
    await redis.del(`pricing:config:${normalizedType}`);
    console.log(`[PRICING] Cache cleared for ${normalizedType}`);
  } catch (err) {
    console.warn('[REDIS] Failed to clear pricing cache:', err.message);
  }
};
/**
 * Gets currently detected weather status
 */
export const getWeatherStatus = async () => {
  return await weatherService.getCurrentWeather();
};
