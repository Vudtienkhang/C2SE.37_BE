
const API_KEY = process.env.OPENWEATHER_API_KEY;
const DEFAULT_CITY = 'Da Nang'; // Can be moved to env or dynamic

/**
 * Fetches current weather by coordinates.
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<Object>} Weather data
 */
export const getCurrentWeather = async (lat, lng) => {
  if (!API_KEY) {
    console.warn('OPENWEATHER_API_KEY is not set. Weather detection will be disabled.');
    return null;
  }

  try {
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

    return {
      temp: data.main.temp,
      condition: data.weather[0].main, // e.g., 'Rain', 'Clouds', 'Clear'
      description: data.weather[0].description,
      isBadWeather: ['Rain', 'Snow', 'Thunderstorm', 'Drizzle', 'Tornado'].includes(data.weather[0].main)
    };
  } catch (error) {
    console.error('Weather Service Error:', error.message);
    return null;
  }
};

