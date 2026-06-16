import redis from '../lib/redis.js';

const API_KEY = process.env.OPENWEATHER_API_KEY;
const DEFAULT_CITY = 'Da Nang'; 
const CACHE_TTL = 900; // 15 minutes

/**
 * Fetches current weather by coordinates with Redis caching.
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<Object>} Weather data
 */
export const getCurrentWeather = async (lat, lng) => {
  if (!API_KEY) {
    console.warn('OPENWEATHER_API_KEY is not set. Weather detection will be disabled.');
    return null;
  }

  // Generate cache key based on rounded coordinates (approx 11km precision)
  // or city name if coords not provided
  const cacheKey = (lat && lng) 
    ? `weather:coord:${parseFloat(lat).toFixed(1)}:${parseFloat(lng).toFixed(1)}`
    : `weather:city:${DEFAULT_CITY.toLowerCase().replace(/\s+/g, '_')}`;

  try {
    // 1. Try to get from cache
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      return JSON.parse(cachedData);
    }

    // 2. Fetch from API if not in cache
    let url;
    if (lat && lng) {
      url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${API_KEY}&units=metric`;
    } else {
      url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(DEFAULT_CITY)}&appid=${API_KEY}&units=metric`;
    }

    const response = await fetch(url);
    const data = await response.json();

    if (data.cod !== 200) {
      throw new Error(data.message || 'Failed to fetch weather');
    }

    const result = {
      temp: data.main.temp,
      condition: data.weather[0].main, // e.g., 'Rain', 'Clouds', 'Clear'
      description: data.weather[0].description,
      isBadWeather: ['Rain', 'Snow', 'Thunderstorm', 'Drizzle', 'Tornado'].includes(data.weather[0].main),
      cachedAt: new Date().toISOString()
    };

    // 3. Save to cache
    await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
    
    return result;
  } catch (error) {
    console.error('Weather Service Error:', error.message);
    // Fallback: Default to good weather to avoid blocking trip requests
    return {
      temp: 25,
      condition: 'Clear',
      isBadWeather: false,
      isFallback: true
    };
  }
};

