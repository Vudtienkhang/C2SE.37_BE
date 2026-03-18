import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
import * as weatherService from './weather.service.js';


/**
 * Calculates trip price based on distance, duration, and conditions.
 * @param {Object} params - Calculation parameters
 * @returns {Promise<Object>} Price breakdown and total
 */
export const calculateTripPrice = async ({
  distanceKm,
  durationMin,
  vehicleType,
  isNight,
  isRushHour,
  weather
}) => {
  if (distanceKm < 0 || durationMin < 0) {
    throw new Error('Distance and duration must be non-negative.');
  }

  // Get active PricingConfig by vehicleType
  const config = await prisma.pricingConfig.findFirst({
    where: { 
      vehicleType,
      isActive: true 
    }
  });

  if (!config) {
    throw new Error(`No active pricing configuration found for vehicle type: ${vehicleType}`);
  }

  const distanceFare = distanceKm * config.perKmPrice;
  const timeFare = durationMin * config.perMinPrice;

  let total = distanceFare + timeFare;

  if (isNight) {
    total *= config.nightMultiplier;
  }

  if (isRushHour) {
    total *= config.rushHourMultiplier;
  }

  let weatherFee = 0;
  // If weather is "auto", fetch real-time weather
  let currentWeather = weather;
  if (weather === 'auto') {
    const weatherData = await weatherService.getCurrentWeather();
    currentWeather = weatherData?.isBadWeather ? 'rain' : 'clear';
  }

  if (currentWeather === "rain" || currentWeather === "storm") {
    weatherFee = config.badWeatherFee;
    total += weatherFee;
  }

  return {
    distanceFare,
    timeFare,
    weatherFee,
    totalPrice: Math.round(total)
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
};
/**
 * Gets currently detected weather status
 */
export const getWeatherStatus = async () => {
  return await weatherService.getCurrentWeather();
};
